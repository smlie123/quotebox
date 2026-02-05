// Options页面的JavaScript逻辑

class OptionsManager {
  constructor() {
    this.articles = [];
    this.filteredArticles = [];
    this.selectedArticles = new Set();
    this.selectionMode = false; // 列表权限/批量管理模式
    this.currentView = 'card'; // 'list' or 'card'
    this.currentLayout = 'waterfall'; // default layout
    this.currentSort = 'date-desc';
    this.categories = [];
    this.currentCategory = 'all';
    this.db = null;
    this.newQuill = null;
    // 统一的 Quill 工具栏配置：新增与编辑保持一致
    // 包含：标题/普通段落、字体颜色、背景色、字号、加粗/斜体/下划线/删除线、引用、代码块、无序/有序列表、链接、图片、对齐、撤销、重做、清除格式
    this.toolbarOptions = [
      [{ header: [1, 2, 3, 4, 5, 6, false] }],
      [{ size: ['small', false, 'large', 'huge'] }],
      [{ color: [] }, { background: [] }],
      ['bold', 'italic', 'underline', 'strike'],
      ['code-block'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'image'],
      [{ align: [] }],
      ['undo', 'redo', 'clean']
    ];
    
    // 分页相关变量
    this.pageSizeCard = 12; // 卡片视图每页12
    this.pageSizeList = 20; // 列表视图每页20
    this.pageSize = this.pageSizeCard; // 当前视图的分页大小（渲染时动态切换）
    this.currentPage = 1;
    this.displayedArticles = []; // 当前显示的文章
    this.isLoading = false;
    this.hasMoreData = true;
    
    this.commentCounts = {}; // Store comment counts
    
    this.init();
  }

  async init() {
    await this.initDatabase();
    this.bindEvents();
    
    // 等待数据库完全初始化
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await this.loadCategories();
    await this.loadArticles();
    
    // 重新渲染分类以显示正确的文章计数
    this.renderCategories();
    
    // 设置默认布局与视图
    const savedLayout = localStorage.getItem('selectedLayout') || 'waterfall';
    const savedView = localStorage.getItem('selectedView') || 'card';
    // 先应用布局（供卡片视图使用）
    this.switchLayout(savedLayout);
    // 再应用视图与下拉选中项
    this.currentView = savedView;
    const displaySwitch = document.getElementById('displaySwitch');
    if (displaySwitch) {
      const targetValue = savedView === 'list' ? 'list' : (savedLayout === 'compact' ? 'card-compact' : 'card-waterfall');
      const activeBtn = displaySwitch.querySelector(`.display-option-btn[data-value="${targetValue}"]`);
      if (activeBtn) {
        displaySwitch.querySelectorAll('.display-option-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
      }

      if (savedView === 'list') {
        this.renderArticles();
      }
    }

    // 检查并显示数据存储提示
    this.checkDataStorageAlert();

    // Listen for refresh messages
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'refreshArticles') {
          this.loadArticles().then(() => {
            this.renderCategories(); // Update counts
          });
        }
      });
    }
  }

  // 检查数据存储提示显示逻辑
  checkDataStorageAlert() {
    const ALERT_STORAGE_KEY = 'dataStorageAlertInfo';
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    let alertInfo = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY));
    
    // 如果是第一次运行，初始化记录
    if (!alertInfo) {
      alertInfo = {
        firstInstallTime: now,
        lastDismissTime: 0
      };
      localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alertInfo));
      // 第一次打开即显示提示
      this.showDataStorageAlert();
      return; 
    }

    // 如果从未关闭过，持续显示提示
    if (alertInfo.lastDismissTime === 0) {
      this.showDataStorageAlert();
      return;
    }

    // 已关闭过，则每隔7天再次提示
    if (now - alertInfo.lastDismissTime > SEVEN_DAYS_MS) {
      this.showDataStorageAlert();
    }
  }

  showDataStorageAlert() {
    const alertBox = document.getElementById('dataStorageAlert');
    if (alertBox) {
      alertBox.classList.remove('hidden');
    }
  }

  dismissDataStorageAlert() {
    const alertBox = document.getElementById('dataStorageAlert');
    if (alertBox) {
      alertBox.classList.add('hidden');
      
      // 记录关闭时间
      const ALERT_STORAGE_KEY = 'dataStorageAlertInfo';
      let alertInfo = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY));
      if (alertInfo) {
        alertInfo.lastDismissTime = Date.now();
        localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alertInfo));
      }
    }
  }

  // 初始化数据库连接
  async initDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('QuoteBoxDB', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建分类表
        if (!db.objectStoreNames.contains('categories')) {
          const categoryStore = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
          categoryStore.createIndex('name', 'name', { unique: true });
          categoryStore.createIndex('created_at', 'created_at');
          
          // 添加默认分类
          categoryStore.transaction.oncomplete = () => {
            const transaction = db.transaction(['categories'], 'readwrite');
            const store = transaction.objectStore('categories');
            const defaultCategories = [
              { name: 'Default', created_at: new Date().toISOString() }
            ];
            defaultCategories.forEach(category => store.add(category));
          };
        }
        
        // 创建article表
        if (!db.objectStoreNames.contains('articles')) {
          const store = db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
          store.createIndex('create_at', 'create_at', { unique: false });
          store.createIndex('from', 'from', { unique: false });
          store.createIndex('categoryId', 'categoryId', { unique: false });
        }
        
        // 创建评论表
        if (!db.objectStoreNames.contains('comments')) {
          const commentStore = db.createObjectStore('comments', { keyPath: 'id', autoIncrement: true });
          commentStore.createIndex('articleId', 'articleId', { unique: false });
          commentStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }



  // 加载所有分类
  async loadCategories() {
    try {
      // 检查是否在扩展环境中
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // 通过扩展API获取分类
        const response = await chrome.runtime.sendMessage({
          action: 'getAllCategories'
        });
        
        if (response.success) {
          this.categories = response.data;
          this.renderCategories();
        } else {
          throw new Error(response.error);
        }
      } else {
        // 直接从数据库获取
        return new Promise((resolve, reject) => {
          const transaction = this.db.transaction(['categories'], 'readonly');
          const store = transaction.objectStore('categories');
          const request = store.getAll();
          
          request.onsuccess = () => {
            this.categories = request.result.sort((a, b) => (a.order || 0) - (b.order || 0));
            this.renderCategories();
            resolve();
          };
          
          request.onerror = () => {
            reject(request.error);
          };
        });
      }
    } catch (error) {
      throw error;
    }
  }

  // 添加分类
  async addCategory(name) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories'], 'readwrite');
      const store = transaction.objectStore('categories');
      const category = {
        name: name,
        created_at: new Date().toISOString()
      };
      
      const request = store.add(category);
      
      request.onsuccess = () => {
        category.id = request.result;
        this.categories.push(category);
        this.renderCategories();
        this.renderManageCategories();
        resolve(category);
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // 更新分类
  async updateCategory(id, name) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories'], 'readwrite');
      const store = transaction.objectStore('categories');
      const request = store.get(id);
      
      request.onsuccess = () => {
        const category = request.result;
        if (category) {
          category.name = name;
          const updateRequest = store.put(category);
          
          updateRequest.onsuccess = () => {
            const index = this.categories.findIndex(c => c.id === id);
            if (index !== -1) {
              this.categories[index] = category;
            }
            this.renderCategories();
            this.renderManageCategories();
            // 立即刷新卡片上显示的分类名称
            this.updateVisibleCardCategoryNames();
            resolve(category);
          };
          
          updateRequest.onerror = () => {
            reject(updateRequest.error);
          };
        } else {
          reject(new Error('Category not found'));
        }
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // 删除分类
  async deleteCategory(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories'], 'readwrite');
      const store = transaction.objectStore('categories');
      const request = store.delete(id);
      
      request.onsuccess = () => {
        this.categories = this.categories.filter(c => c.id !== id);
        this.renderCategories();
        this.renderManageCategories();
        resolve();
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  bindEvents() {
    // 数据存储提示关闭
    const closeAlertBtn = document.getElementById('closeAlertBtn');
    if (closeAlertBtn) {
      closeAlertBtn.addEventListener('click', () => {
        this.dismissDataStorageAlert();
      });
    }

    // 立即备份按钮：显示导出弹窗
    const backupNowBtn = document.getElementById('backupNowBtn');
    if (backupNowBtn) {
      backupNowBtn.addEventListener('click', () => {
        this.showExportModal();
      });
    }

    // 搜索功能
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.filterArticles(e.target.value);
    });

    // 排序功能
    document.getElementById('defaultSort').addEventListener('click', () => {
      this.setSort('time');
    });
    
    document.getElementById('randomSort').addEventListener('click', () => {
      this.setSort('random');
    });

    // 展示切换：Card（瀑布流）、Equal Height（等高）、List（列表）
    const displaySwitch = document.getElementById('displaySwitch');
    if (displaySwitch) {
      displaySwitch.querySelectorAll('.display-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const value = btn.dataset.value;
          
          // Update UI
          displaySwitch.querySelectorAll('.display-option-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          if (value === 'list') {
            this.currentView = 'list';
            localStorage.setItem('selectedView', 'list');
            this.renderArticles();
          } else {
            this.currentView = 'card';
            localStorage.setItem('selectedView', 'card');
            const layout = value === 'card-compact' ? 'compact' : 'waterfall';
            this.switchLayout(layout);
          }
        });
      });
    }





    // 文件输入处理
    document.getElementById('fileInput').addEventListener('change', (e) => {
      this.importData(e.target.files[0]);
    });

    // 模态框
    document.getElementById('closeModal').addEventListener('click', () => {
      this.closeModal();
    });

    // 点击背景遮罩关闭模态框
    document.getElementById('modalOverlay').addEventListener('click', () => {
      this.closeModal();
    });

    // 评论功能
    document.getElementById('submitComment').addEventListener('click', () => {
      this.submitComment();
    });

    document.getElementById('commentInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        this.submitComment();
      }
    });

    // 工具栏按钮
    document.getElementById('exportImageBtn').addEventListener('click', () => {
      this.exportImage();
    });

    document.getElementById('exportPdfBtn').addEventListener('click', () => {
      this.exportPdf();
    });

    document.getElementById('copyContentBtn').addEventListener('click', () => {
      this.copyModalText();
    });

    document.getElementById('deleteContentBtn').addEventListener('click', () => {
      if (this.currentArticleId) {
        this.deleteArticle(this.currentArticleId);
      }
    });

    // 编辑相关按钮
    document.getElementById('editContentBtn').addEventListener('click', () => {
      this.enterEditMode();
    });
    document.getElementById('saveEditBtn').addEventListener('click', () => {
      this.saveEditedContent();
    });
    document.getElementById('cancelEditBtn').addEventListener('click', () => {
      this.cancelEditMode();
    });

    // 新增文章相关按钮
    const addArticleBtn = document.getElementById('addArticleBtn');
    if (addArticleBtn) {
      addArticleBtn.addEventListener('click', () => this.showNewArticleModal());
    }
    const closeNewArticleModalBtn = document.getElementById('closeNewArticleModal');
    if (closeNewArticleModalBtn) {
      closeNewArticleModalBtn.addEventListener('click', () => this.closeNewArticleModal());
    }
    const saveNewArticleBtn = document.getElementById('saveNewArticleBtn');
    if (saveNewArticleBtn) {
      saveNewArticleBtn.addEventListener('click', () => this.saveNewArticle());
    }
    const newArticleOverlay = document.getElementById('newArticleOverlay');
    if (newArticleOverlay) {
      newArticleOverlay.addEventListener('click', () => this.closeNewArticleModal());
    }

    // 分类管理
    document.getElementById('categoryManageBtn').addEventListener('click', () => {
      this.showCategoryModal();
    });
    document.getElementById('closeCategoryModal').addEventListener('click', () => {
      this.closeCategoryModal();
    });
    document.getElementById('addCategoryBtn').addEventListener('click', () => {
      this.handleAddCategory();
    });
    document.getElementById('categoryModal').addEventListener('click', (e) => {
      if (e.target.id === 'categoryModal') {
        this.closeCategoryModal();
      }
    });

    // 分类重命名弹窗事件绑定
    document.getElementById('closeCategoryRenameModal').addEventListener('click', () => {
      this.closeCategoryRenameModal();
    });
    document.getElementById('cancelCategoryRenameBtn').addEventListener('click', () => {
      this.closeCategoryRenameModal();
    });
    document.getElementById('saveCategoryRenameBtn').addEventListener('click', () => {
      this.saveCategoryRename();
    });
    document.getElementById('categoryRenameModal').addEventListener('click', (e) => {
      if (e.target.id === 'categoryRenameModal') {
        this.closeCategoryRenameModal();
      }
    });

    // 菜单按钮
    document.getElementById('menuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsMenu();
    });
    document.getElementById('exportDataBtn').addEventListener('click', () => {
      this.showExportModal();
      this.hideSettingsMenu();
    });
    document.getElementById('importDataBtn').addEventListener('click', () => {
      this.showImportModal();
      this.hideSettingsMenu();
    });
    document.getElementById('aboutBtn').addEventListener('click', () => {
      this.showAbout();
      this.hideSettingsMenu();
    });
    // 联系我们
    const contactBtn = document.getElementById('contactBtn');
    if (contactBtn) {
      contactBtn.addEventListener('click', () => {
        this.showContact();
        this.hideSettingsMenu();
      });
    }

    // 关于我们和联系我们弹窗关闭按钮
    document.getElementById('closeAboutModal').addEventListener('click', () => {
      this.closeAboutModal();
    });
    // 关闭联系我们
    const closeContactBtn = document.getElementById('closeContactModal');
    if (closeContactBtn) {
      closeContactBtn.addEventListener('click', () => {
        this.closeContactModal();
      });
    }

    // 点击背景关闭弹窗
    document.getElementById('aboutModal').addEventListener('click', (e) => {
      if (e.target.id === 'aboutModal') {
        this.closeAboutModal();
      }
    });
    const contactModal = document.getElementById('contactModal');
    if (contactModal) {
      contactModal.addEventListener('click', (e) => {
        if (e.target.id === 'contactModal') {
          this.closeContactModal();
        }
      });
    }
    // 联系我们弹窗已移除

    // 导出弹窗事件
    const exportModalEl = document.getElementById('exportModal');
    if (exportModalEl) {
      document.getElementById('closeExportModal').addEventListener('click', () => this.closeExportModal());
      document.getElementById('cancelExportBtn').addEventListener('click', () => this.closeExportModal());
      document.getElementById('confirmExportBtn').addEventListener('click', () => {
        this.closeExportModal();
        this.exportData();
      });
      exportModalEl.addEventListener('click', (e) => {
        if (e.target.id === 'exportModal') this.closeExportModal();
      });
      
      const historyBtn = document.getElementById('viewExportHistoryBtn');
      if (historyBtn) {
        historyBtn.addEventListener('click', () => {
          this.closeExportModal();
          this.showExportHistory();
        });
      }
    }

    // Export History Modal Events
    const historyModal = document.getElementById('exportHistoryModal');
    if (historyModal) {
      document.getElementById('closeExportHistoryModal').addEventListener('click', () => {
        historyModal.classList.add('hidden');
      });
      historyModal.addEventListener('click', (e) => {
        if (e.target.id === 'exportHistoryModal') historyModal.classList.add('hidden');
      });
    }

    // 导入弹窗事件
    const importModalEl = document.getElementById('importModal');
    if (importModalEl) {
      document.getElementById('closeImportModal').addEventListener('click', () => this.closeImportModal());
      document.getElementById('cancelImportBtn').addEventListener('click', () => this.closeImportModal());
      document.getElementById('confirmImportBtn').addEventListener('click', () => {
        this.closeImportModal();
        document.getElementById('fileInput').click();
      });
      importModalEl.addEventListener('click', (e) => {
        if (e.target.id === 'importModal') this.closeImportModal();
      });
    }

    // 分类选择弹窗
    document.getElementById('confirmCategorySelection').addEventListener('click', () => {
      this.confirmCategorySelection();
    });
    document.getElementById('closeCategoryEditModal').addEventListener('click', () => {
      this.closeCategoryEditModal();
    });
    // 移除不存在的categoryModal绑定
    
    // 卡片分类选择弹窗事件
    document.getElementById('closeCardCategoryModal').addEventListener('click', () => {
      this.closeCardCategoryModal();
    });
    
    document.getElementById('confirmCardCategorySelection').addEventListener('click', () => {
      this.confirmCardCategorySelection();
    });
    
    // 分类选项点击事件（使用事件委托）
    document.getElementById('categoryList').addEventListener('click', (e) => {
      const categoryOption = e.target.closest('.category-option');
      if (categoryOption) {
        // 移除其他选中状态
        document.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
        // 添加选中状态
        categoryOption.classList.add('selected');
        this.selectedCategoryName = categoryOption.dataset.category;
      }
    });

    // 点击其他地方关闭菜单
    document.addEventListener('click', () => {
      this.hideSettingsMenu();
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        this.closeCategoryModal();
        this.closeCategoryEditModal();
        this.hideSettingsMenu();
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a') {
          e.preventDefault();
          this.toggleSelectAll();
        }
        if (e.key === 'f') {
          e.preventDefault();
          document.getElementById('searchInput').focus();
        }
      }
    });
  }

  showNewArticleModal() {
    const overlay = document.getElementById('newArticleOverlay');
    const drawer = document.getElementById('newArticleDrawer');
    const categorySelect = document.getElementById('newArticleCategory');
    const titleInput = document.getElementById('newArticleTitle');
    const addBtn = document.getElementById('addArticleBtn');
    if (!overlay || !drawer || !categorySelect || !titleInput) return;

    // 重置输入
    titleInput.value = '';
    categorySelect.innerHTML = '';

    // 填充分类下拉
    this.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      categorySelect.appendChild(opt);
    });

    // 预选当前分类（如果不是 all）
    if (this.currentCategory !== 'all') {
      const currentCat = this.categories.find(c => String(c.id) === String(this.currentCategory));
      if (currentCat) categorySelect.value = currentCat.id;
    }

    // 初始化或重置 Quill 编辑器（使用统一配置）
    if (!this.newQuill) {
      // 本地简版 Quill 仅支持数组容器的 toolbar 配置
      this.newQuill = new Quill('#newEditor', { theme: 'snow', modules: { toolbar: this.toolbarOptions } });
    } else {
      this.newQuill.setContents([]);
    }

    overlay.classList.remove('hidden');
    drawer.classList.remove('hidden');
    if (addBtn) addBtn.classList.add('hidden');
  }

  closeNewArticleModal() {
    const overlay = document.getElementById('newArticleOverlay');
    const drawer = document.getElementById('newArticleDrawer');
    const addBtn = document.getElementById('addArticleBtn');
    if (overlay) overlay.classList.add('hidden');
    if (drawer) drawer.classList.add('hidden');
    if (addBtn) addBtn.classList.remove('hidden');
  }

  async saveNewArticle() {
    const titleEl = document.getElementById('newArticleTitle');
    const categoryEl = document.getElementById('newArticleCategory');
    // 即使隐藏了标题/分类输入，也允许保存：自动生成标题并使用当前分类/默认分类
    const html = this.newQuill ? this.newQuill.root.innerHTML : '';
    const plainText = this.newQuill
      ? (typeof this.newQuill.getText === 'function'
          ? this.newQuill.getText().trim()
          : this.getPlainText(this.newQuill.root.innerHTML).trim())
      : '';
    const autoTitle = (() => {
      if (plainText) {
        const firstLine = plainText.split('\n').find(line => line.trim().length > 0) || plainText;
        return firstLine.trim().slice(0, 60);
      }
      // 回退到输入框值（如果存在）或默认标题
      const inputTitle = titleEl ? titleEl.value.trim() : '';
      return inputTitle || 'Untitled';
    })();
    // 分类优先使用当前选中分类（若是数字ID），否则取输入框的值（如果存在），再否则使用默认1
    let categoryId = 1;
    if (this.currentCategory && !isNaN(parseInt(this.currentCategory, 10))) {
      categoryId = parseInt(this.currentCategory, 10);
    } else if (categoryEl) {
      const parsed = parseInt(categoryEl.value, 10);
      if (!isNaN(parsed)) categoryId = parsed;
    }

    if (!html || html.trim() === '<p><br></p>') {
      this.showToast('Add some content before saving.', 'error');
      return;
    }

    const article = {
      title: autoTitle,
      content: html,
      from: 'created',
      categoryId: isNaN(categoryId) ? 1 : categoryId,
      create_at: new Date().toISOString()
    };

    try {
      const id = await this.addArticleToDB(article);
      article.id = id;
      // 更新内存与视图
      this.articles.unshift(article);
      this.filteredArticles = [...this.articles];
      this.sortArticles();
      this.renderArticles();
      this.closeNewArticleModal();
      this.showToast('Article saved.');
    } catch (err) {
      this.showError('Save failed. Please try again.');
    }
  }

  addArticleToDB(article) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const tx = this.db.transaction(['articles'], 'readwrite');
      const store = tx.objectStore('articles');
      const req = store.add(article);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }


  async loadArticles() {
    this.showLoading(true);
    
    try {
      // 检查是否在扩展环境中
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // Fetch articles and comment counts in parallel
        try {
          const [articlesResponse, countsResponse] = await Promise.all([
            chrome.runtime.sendMessage({ action: 'getAllArticles' }),
            chrome.runtime.sendMessage({ action: 'getAllCommentCounts' })
          ]);
          
          
          if (articlesResponse.success) {
            this.articles = articlesResponse.data;
            
            if (countsResponse && countsResponse.success) {
              this.commentCounts = countsResponse.counts || {};
            } else {
              this.commentCounts = {};
            }

            this.filterArticlesByCategory();
          } else {
            this.showError('Failed to load data: ' + articlesResponse.error);
          }
        } catch (err) {
          // Try fetching just articles if parallel fetch failed
          const articlesResponse = await chrome.runtime.sendMessage({ action: 'getAllArticles' });
          if (articlesResponse.success) {
            this.articles = articlesResponse.data;
            this.filterArticlesByCategory();
          }
        }
      } else {
        // 开发环境或直接从数据库加载
        if (this.db) {
          const transaction = this.db.transaction(['articles'], 'readonly');
          const store = transaction.objectStore('articles');
          const request = store.getAll();
          
          await new Promise((resolve, reject) => {
            request.onsuccess = () => {
              this.articles = request.result.sort((a, b) => new Date(b.create_at) - new Date(a.create_at));
              resolve();
            };
            request.onerror = () => reject(request.error);
          });
        } else {
          // 开发环境模拟数据
          this.articles = [
            {
              id: 1,
              content: 'A person’s actions often hinge on their own time and choices—sometimes independent of society or friends. Extreme independence makes personal time the most basic unit.',
              from: 'https://example.com/article1',
              create_at: '2025/01/01'
            },
            {
              id: 2,
              content: 'This is another article used to demonstrate the card view. The content may be lengthy and should be truncated appropriately.',
              from: 'https://github.com/example',
              create_at: '2025/01/02'
            },
            {
              id: 3,
              content: 'This is the third article, showing how multiple cards are laid out.',
              from: 'https://stackoverflow.com/questions/example',
              create_at: '2025/01/03'
            }
          ];
          
          // 模拟评论统计
          this.commentCounts = {
            1: 3,
            3: 1
          };
        }
        this.filterArticlesByCategory();
      }
    } catch (error) {
      this.showError("Couldn’t load data. Please try again.");
    } finally {
      this.showLoading(false);
    }
  }

  filterArticles(query) {
    if (!query.trim()) {
      this.filteredArticles = [...this.articles];
    } else {
      const searchTerm = query.toLowerCase();
      this.filteredArticles = this.articles.filter(article => 
        article.content.toLowerCase().includes(searchTerm) ||
        article.from.toLowerCase().includes(searchTerm)
      );
    }
    this.selectedArticles.clear();
    this.sortArticles();
    this.renderArticles();
  }

  setSort(sortType) {
    this.currentSort = sortType;
    
    // 更新UI状态
    document.querySelectorAll('.sort-option').forEach(option => {
      option.classList.remove('active');
    });
    
    if (sortType === 'time') {
      document.getElementById('defaultSort').classList.add('active');
    } else if (sortType === 'random') {
      document.getElementById('randomSort').classList.add('active');
    }
    
    this.sortArticles();
    this.renderArticles();
  }

  sortArticles() {
    if (this.currentSort === 'random') {
      // 随机排序
      for (let i = this.filteredArticles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.filteredArticles[i], this.filteredArticles[j]] = [this.filteredArticles[j], this.filteredArticles[i]];
      }
    } else {
      // 按时间排序（默认最新在前）
      this.filteredArticles.sort((a, b) => {
        return new Date(b.create_at) - new Date(a.create_at);
      });
    }
  }

  switchLayout(layout) {
    this.currentLayout = layout;
    localStorage.setItem('selectedLayout', layout);
    
    // 更新UI中的布局选择状态
    const layoutButtons = document.querySelectorAll('[data-layout]');
    layoutButtons.forEach(btn => {
      const isCurrent = btn.dataset.layout === layout;
      btn.classList.toggle('active', isCurrent);
      btn.style.display = isCurrent ? 'inline-flex' : 'none';
    });
    
    // 重新渲染文章以应用新布局
    this.renderArticles();
  }

  renderArticles(append = false, resetPage = true) {
    const container = document.getElementById('articleContainer');
    const emptyState = document.getElementById('emptyState');

    // 确保无论是否有文章，都更新回收站通知的状态
    this.renderRecycleNotice();
    
    if (this.filteredArticles.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      this.displayedArticles = [];
      this.currentPage = 1;
      this.hasMoreData = true;
      return;
    }
    
    emptyState.classList.add('hidden');
    // 根据视图动态设置每页数量
    this.pageSize = this.currentView === 'list' ? this.pageSizeList : this.pageSizeCard;
    container.className = `article-container ${this.currentView}-view layout-${this.currentLayout}`;
    
    if (!append && resetPage) {
      // 重新开始渲染（根据调用方决定是否重置页码）
      this.currentPage = 1;
      this.displayedArticles = [];
      this.hasMoreData = true;
    }
    
    // 计算要显示的文章
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    const newArticles = this.filteredArticles.slice(startIndex, endIndex);
    
    if (newArticles.length === 0) {
      this.hasMoreData = false;
      // 列表模式使用分页，不显示加载更多状态
      if (this.currentView !== 'list') this.showLoadMoreStatus();
      return;
    }
    
    // 更新显示的文章列表
    if (append) {
      this.displayedArticles = [...this.displayedArticles, ...newArticles];
    } else {
      this.displayedArticles = newArticles;
    }
    
    // 检查是否还有更多数据
    this.hasMoreData = endIndex < this.filteredArticles.length;
    
    if (this.currentView === 'list') {
      this.renderListView(container, append);
    } else {
      this.renderCardView(container, append);
    }
    
    this.bindArticleEvents();
    // 列表模式使用分页，禁用滚动加载和加载更多提示
    if (this.currentView !== 'list') {
      this.bindScrollListener();
      this.showLoadMoreStatus();
    }
  }

  renderRecycleNotice() {
    const noticeContainer = document.getElementById('recycleNoticeContainer');
    if (!noticeContainer) return;
    
    if (this.currentCategory === 'recycle') {
      noticeContainer.innerHTML = `
        <div class="recycle-notice">
          <span>Items deleted here will be permanently removed.</span>
          <button id="emptyRecycleBinBtn" class="btn btn-small">Empty Trash</button>
        </div>
      `;
      const emptyBtn = document.getElementById('emptyRecycleBinBtn');
      if (emptyBtn) emptyBtn.addEventListener('click', () => this.emptyRecycleBin());
    } else {
      noticeContainer.innerHTML = '';
    }
  }

  renderListView(container, append = false) {
    // 强制列表视图始终为选择模式
    this.selectionMode = true;

    if (!append) {
      // 顶部工具栏（批量管理/权限模式）
      const selectedCount = this.displayedArticles.filter(a => this.selectedArticles.has(Number(a.id))).length;
      const toolbarHtml = `
        <div class="list-toolbar" id="listToolbar">
          <label class="toolbar-btn" title="Select all items on this page">
            <input type="checkbox" id="listSelectAllCheckbox" ${this.isAllSelected() ? 'checked' : ''} /> Select All
          </label>
          ${this.currentCategory === 'recycle' ? `<button class="toolbar-btn" id="batchRestoreBtn" ${selectedCount === 0 ? 'disabled' : ''}>Restore Selected</button>` : ''}
          <button class="toolbar-btn toolbar-btn-danger" id="batchDeleteBtn" ${selectedCount === 0 ? 'disabled' : ''}>${this.currentCategory === 'recycle' ? 'Delete Selected Forever' : 'Delete Selected'}</button>
        </div>
        <div class="list-body" id="listBody"></div>
        <div class="pagination" id="listPagination"></div>
      `;
      container.innerHTML = toolbarHtml;
    }
    
    const listBody = document.getElementById('listBody');
    // 修复：当append=true时，只渲染新加载的文章
    const articlesToRender = append ? this.displayedArticles.slice(-this.pageSize) : this.displayedArticles;
    const newRows = articlesToRender.map(article => {
      // 在回收站视图下，优先显示 deletedAt 时间
      const isRecycle = this.currentCategory === 'recycle';
      const timeToDisplay = isRecycle && article.deletedAt ? article.deletedAt : article.create_at;
      const categoryName = this.getCategoryNameById(article.categoryId);
      const plainText = this.getPlainText(article.content).trim();
      const firstImage = this.getFirstImage(article.content);
      const titleText = (article.title || '').trim() || this.truncateText(plainText, 50);
      const linkHref = (article.from || '').trim();
      const linkText = linkHref ? this.getDomainFromUrl(linkHref) : '';
      
      return `
      <div class="list-row" data-id="${article.id}">
        ${this.selectionMode ? `
        <div class="list-cell select-cell">
          <input type="checkbox" class="article-checkbox" data-id="${article.id}" ${this.selectedArticles.has(Number(article.id)) ? 'checked' : ''} />
        </div>
        ` : ''}
        <div class="list-cell category-cell" title="${this.escapeHtml(categoryName)}">
          <div class="card-category-tag" data-id="${article.id}" data-category-id="${article.categoryId || 1}">
            <span class="category-name">${this.escapeHtml(categoryName || 'Default')}</span>
            <svg class="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        </div>
        <div class="list-cell title-cell">
          <a href="#" class="list-title" data-id="${article.id}" title="${this.escapeHtml(titleText)}">
            ${firstImage ? `<img src="${firstImage}" style="height:50px;width:auto;object-fit:cover;border-radius:4px;display:inline-block;vertical-align:middle;" />` : this.escapeHtml(titleText)}
          </a>
        </div>
        <div class="list-cell link-cell">
          ${linkHref ? `<a href="${this.escapeHtml(linkHref)}" target="_blank" rel="noopener noreferrer" class="source-info" title="${this.escapeHtml(linkHref)}">${this.escapeHtml(linkText)}</a>` : '<span class="source-info">-</span>'}
        </div>
        <div class="list-cell date-cell">
          <div class="date-info" title="${this.formatFullDate(timeToDisplay)}">
            ${this.formatDate(timeToDisplay)}
          </div>
        </div>
        <div class="list-cell actions-cell">
          ${isRecycle ? `
          <button class="btn-action restore-btn" title="Restore" data-id="${article.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 4 4 4 1"></polyline>
              <path d="M4 4l6 0a8 8 0 1 1 -7 8"></path>
            </svg>
          </button>
          ` : ''}
          <button class="btn-action delete-btn" title="${isRecycle ? 'Delete forever' : 'Delete'}" data-id="${article.id}">
            <i class="iconfont icon-delete"></i>
          </button>
        </div>
      </div>
    `}).join('');
    
    if (append) {
      listBody.insertAdjacentHTML('beforeend', newRows);
    } else {
      listBody.innerHTML = newRows;
    }

    // 渲染底部分页信息与控制
    const totalItems = this.filteredArticles.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / this.pageSize));
    const pagination = document.getElementById('listPagination');
    if (pagination) {
      pagination.innerHTML = `
        <button class="toolbar-btn" id="prevPageBtn" ${this.currentPage <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="pagination-info">Page ${this.currentPage} of ${totalPages} · ${totalItems} items</span>
        <button class="toolbar-btn" id="nextPageBtn" ${this.currentPage >= totalPages ? 'disabled' : ''}>Next</button>
      `;
      const prevBtn = document.getElementById('prevPageBtn');
      const nextBtn = document.getElementById('nextPageBtn');
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (this.currentPage > 1) {
            this.currentPage--;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            this.renderArticles(false, false);
          }
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (this.currentPage < totalPages) {
            this.currentPage++;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            this.renderArticles(false, false);
          }
        });
      }
    }

    // 绑定列表工具栏事件（每次渲染时）
    const selectAllCb = document.getElementById('listSelectAllCheckbox');
    if (selectAllCb) {
      selectAllCb.addEventListener('change', (e) => {
        this.toggleSelectAll(e.target.checked);
      });
    }
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    if (batchDeleteBtn) {
      batchDeleteBtn.addEventListener('click', () => this.batchDeleteSelected());
    }
    const batchRestoreBtn = document.getElementById('batchRestoreBtn');
    if (batchRestoreBtn) {
      batchRestoreBtn.addEventListener('click', () => this.batchRestoreSelected());
    }
    // 初次渲染后根据选择数量更新按钮可用状态
    this.updateBatchButtonsState();
  }

  renderCardView(container, append = false) {
    // 修复：当append=true时，只渲染新加载的文章
    const articlesToRender = append ? this.displayedArticles.slice(-this.pageSize) : this.displayedArticles;
    const newCards = articlesToRender.map(article => {
      const plainText = this.getPlainText(article.content);
      const firstImage = this.getFirstImage(article.content);
      const commentCount = this.commentCounts[article.id] || this.commentCounts[String(article.id)] || 0;
      
      let cardContentHtml = '';
      if (firstImage) {
        cardContentHtml += `
          <div class="card-image-container" style="margin-bottom: 10px; border-radius: 4px; overflow: hidden; max-height: 200px;">
            <img src="${firstImage}" style="width: 100%; height: 100%; object-fit: cover; object-position: top; display: block;" loading="lazy">
          </div>
        `;
      }
      
      if (plainText) {
        cardContentHtml += `<div class="card-text">${this.escapeHtml(plainText)}</div>`;
      } else if (!firstImage) {
        cardContentHtml += `<div class="card-text"></div>`;
      }

      return `
      <div class="card-item" data-id="${article.id}">
        <div class="card-content">
          ${cardContentHtml}
        </div>
        <div class="card-footer-single-row">
          <div class="card-category-tag" data-id="${article.id}" data-category-id="${article.categoryId || 1}">
            <span class="category-name">${this.getCategoryNameById(article.categoryId || 1)}</span>
            <svg class="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
          <div class="card-meta-inline">
            <a href="${article.from}" class="card-source-icon" title="${this.escapeHtml(article.from)}" target="_blank">
              <i class="iconfont icon-link"></i>
            </a>
          </div>
          ${commentCount > 0 ? `<div class="card-comment-info" style="display: flex; align-items: center; color: #6c757d; font-size: 12px; margin-right: auto;">
            <i class="iconfont icon-comment" style="font-size: 14px; margin-right: 2px;"></i>${commentCount}
          </div>` : '<div style="margin-right: auto;"></div>'}
          <div class="card-actions-inline">
            ${this.currentCategory === 'recycle' 
              ? `<span class="card-time" title="${this.formatFullDateEn(article.deletedAt || article.create_at)}">Deleted: ${this.formatDateEn(article.deletedAt || article.create_at)}</span>`
              : `<span class="card-time" title="${this.formatFullDateEn(article.create_at)}">${this.formatDateEn(article.create_at)}</span>`}
            ${this.currentCategory === 'recycle' ? `
            <button class="btn-action restore-btn" title="Restore" data-id="${article.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 4 4 4 1"></polyline>
                <path d="M4 4l6 0a8 8 0 1 1 -7 8"></path>
              </svg>
            </button>
            ` : ''}
            <button class="btn-action delete-btn" title="${this.currentCategory === 'recycle' ? 'Delete forever' : 'Delete'}" data-id="${article.id}">
              <i class="iconfont icon-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    }).join('');
    
    if (append) {
      container.insertAdjacentHTML('beforeend', newCards);
    } else {
      container.innerHTML = newCards;
    }
  }

  bindArticleEvents() {
    // 复选框事件
    document.querySelectorAll('.article-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) {
          this.selectedArticles.add(id);
        } else {
          this.selectedArticles.delete(id);
        }
        // 更新批量按钮的可用状态
        this.updateBatchButtonsState();
      });
    });

    // 头部复选框（仅列表视图）
    const headerCheckbox = document.getElementById('headerCheckbox');
    if (headerCheckbox) {
      headerCheckbox.addEventListener('change', (e) => {
        this.toggleSelectAll();
      });
    }

    // 卡片内容点击事件：仅点击内容区域打开详情
    document.querySelectorAll('.card-content').forEach(content => {
      content.addEventListener('click', (e) => {
        const card = content.closest('.card-item');
        if (!card) return;
        const id = parseInt(card.dataset.id);
        this.viewArticle(id);
      });
    });

    // 列表标题点击打开详细内容
    document.querySelectorAll('.list-title').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = parseInt(link.dataset.id);
        this.viewArticle(id);
      });
    });

    // 操作按钮

    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        if (this.currentCategory === 'recycle') {
          this.deleteForever(id);
        } else {
          this.deleteArticle(id);
        }
      });
    });

    // 恢复按钮
    document.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        if (this.currentCategory !== 'recycle') {
          this.showToast('Restore is available in Trash only');
          return;
        }
        this.restoreArticle(id);
      });
    });

    // 分类标签点击事件
    document.querySelectorAll('.card-category-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(tag.dataset.id);
        this.showCardCategoryModal(id);
      });
    });
  }

  // 是否当前页已全选
  isAllSelected() {
    const ids = this.displayedArticles.map(a => Number(a.id));
    return ids.length > 0 && ids.every(id => this.selectedArticles.has(id));
  }

  // 切换全选（在列表权限模式下使用）
  toggleSelectAll(forceState) {
    const ids = this.displayedArticles.map(a => Number(a.id));
    const shouldSelect = typeof forceState === 'boolean' ? forceState : !this.isAllSelected();
    if (shouldSelect) {
      ids.forEach(id => this.selectedArticles.add(id));
    } else {
      ids.forEach(id => this.selectedArticles.delete(id));
    }
    // 更新UI
    this.renderArticles();
  }

  // 获取当前页已选择的条目数量
  getSelectedCountOnCurrentPage() {
    return this.displayedArticles.filter(a => this.selectedArticles.has(Number(a.id))).length;
  }

  // 根据当前页选择数量更新批量按钮禁用状态
  updateBatchButtonsState() {
    const count = this.getSelectedCountOnCurrentPage();
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    const batchRestoreBtn = document.getElementById('batchRestoreBtn');
    if (batchDeleteBtn) batchDeleteBtn.disabled = count === 0;
    if (batchRestoreBtn) batchRestoreBtn.disabled = count === 0;
  }

  // 批量删除所选（正常视图移动到Trash，Trash视图永久删除）
  async batchDeleteSelected() {
    const ids = Array.from(this.selectedArticles);
    if (ids.length === 0) {
      this.showToast('No items selected.', 'error');
      return;
    }
    const confirmText = this.currentCategory === 'recycle'
      ? `This will permanently delete ${ids.length} item(s). Continue?`
      : `Move ${ids.length} item(s) to Trash? Continue?`;
    if (!confirm(confirmText)) return;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // 扩展环境：逐个发送并等待
        for (const id of ids) {
          if (this.currentCategory === 'recycle') {
            await chrome.runtime.sendMessage({ action: 'deleteForever', id: Number(id) });
          } else {
            await chrome.runtime.sendMessage({ action: 'deleteArticle', id: Number(id) });
          }
        }
      } else if (this.db) {
        // 本地IndexedDB环境
        const transaction = this.db.transaction(['articles'], 'readwrite');
        const store = transaction.objectStore('articles');
        await Promise.all(ids.map(id => new Promise((resolve, reject) => {
          const getRequest = store.get(Number(id));
          getRequest.onsuccess = () => {
            const article = getRequest.result;
            if (!article) return resolve();
            if (this.currentCategory === 'recycle') {
              // 永久删除
              const delReq = store.delete(Number(id));
              delReq.onsuccess = () => resolve();
              delReq.onerror = () => reject(delReq.error);
            } else {
              // 软删除
              article.deleted = true;
              article.deletedAt = new Date().toISOString();
              const putRequest = store.put(article);
              putRequest.onsuccess = () => resolve();
              putRequest.onerror = () => reject(putRequest.error);
            }
          };
          getRequest.onerror = () => reject(getRequest.error);
        })));
      }

      // 清理并刷新
      this.selectedArticles.clear();
      await this.loadArticles();
      this.renderCategories();
      this.filterArticlesByCategory();
      this.renderArticles();
      this.showToast(this.currentCategory === 'recycle' ? 'Permanently deleted selected items.' : 'Moved selected items to Trash.');
    } catch (err) {
      this.showToast('Select delete failed', 'error');
    }
  }

  // 批量恢复所选（仅 Trash 视图）
  async batchRestoreSelected() {
    if (this.currentCategory !== 'recycle') {
      this.showToast('Restore is available in Trash only', 'error');
      return;
    }
    const ids = Array.from(this.selectedArticles);
    if (ids.length === 0) {
      this.showToast('No items selected.', 'error');
      return;
    }
    if (!confirm(`Restore ${ids.length} item(s) from Trash?`)) return;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        for (const id of ids) {
          await chrome.runtime.sendMessage({ action: 'restoreArticle', id: Number(id) });
        }
      } else if (this.db) {
        const transaction = this.db.transaction(['articles'], 'readwrite');
        const store = transaction.objectStore('articles');
        await Promise.all(ids.map(id => new Promise((resolve, reject) => {
          const getRequest = store.get(Number(id));
          getRequest.onsuccess = () => {
            const article = getRequest.result;
            if (!article) return resolve();
            article.deleted = false;
            delete article.deletedAt;
            const putRequest = store.put(article);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          };
          getRequest.onerror = () => reject(getRequest.error);
        })));
      }

      this.selectedArticles.clear();
      await this.loadArticles();
      this.renderCategories();
      this.filterArticlesByCategory();
      this.renderArticles();
      this.showToast('Restored selected items.');
    } catch (err) {
      this.showToast('Select restore failed', 'error');
    }
  }

  // 绑定滚动监听
  bindScrollListener() {
    // 页面滚动在 window 上进行，统一绑定 window 滚动监听
    this.bindWindowScrollListener();
  }

  // 绑定window滚动监听（备用方案）
  bindWindowScrollListener() {
    // 移除之前的监听器
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener);
    }
    
    this.scrollListener = () => {
      if (this.isLoading || !this.hasMoreData) {
        return;
      }
      
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      
      
      
      // 当滚动到距离底部200px时开始加载
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        this.loadMoreArticles();
      }
    };
    
    window.addEventListener('scroll', this.scrollListener);
  }

  // 加载更多文章
  async loadMoreArticles() {
    // 列表模式使用分页，不执行滚动加载
    if (this.currentView === 'list') {
      return;
    }
    if (this.isLoading || !this.hasMoreData) {
      return;
    }
    
    this.isLoading = true;
    this.showLoadMoreStatus();
    
    try {
      // 计算要获取的数据范围
      const startIndex = this.currentPage * this.pageSize;
      const endIndex = startIndex + this.pageSize;
      
      
      // 从filteredArticles中获取下一页的12条数据
      const newArticles = this.filteredArticles.slice(startIndex, endIndex);
      
      if (newArticles.length === 0) {
        this.hasMoreData = false;
        this.showLoadMoreStatus();
        this.isLoading = false;
        return;
      }
      
      // 模拟加载延迟
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 将新文章添加到displayedArticles
      this.displayedArticles = [...this.displayedArticles, ...newArticles];
      this.currentPage++;
      
      
      // 检查是否还有更多数据
      this.hasMoreData = endIndex < this.filteredArticles.length;
      
      // 渲染新文章
      this.renderArticles(true);
      
    } catch (error) {
    } finally {
      this.isLoading = false;
      this.showLoadMoreStatus();
    }
  }

  // 显示加载更多状态
  showLoadMoreStatus() {
    
    
    // 列表模式不展示“加载更多/已显示全部”状态
    if (this.currentView === 'list') {
      const existing = document.getElementById('loadMoreStatus');
      if (existing) existing.style.display = 'none';
      return;
    }
    
    let statusElement = document.getElementById('loadMoreStatus');
    
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'loadMoreStatus';
      statusElement.className = 'load-more-status';
      
      const container = document.getElementById('articleContainer');
      if (container) {
        container.parentNode.insertBefore(statusElement, container.nextSibling);
      } else {
      }
    }
    
    if (this.isLoading) {
      statusElement.innerHTML = `
        <div class="loading-more">
          <div class="spinner"></div>
          <span>Loading...</span>
        </div>
      `;
      statusElement.style.display = 'flex';
    } else if (!this.hasMoreData && this.displayedArticles.length > 0) {
      statusElement.innerHTML = `
        <div class="no-more-data">
          <span>All content displayed</span>
        </div>
      `;
      statusElement.style.display = 'flex';
    } else {
      statusElement.style.display = 'none';
    }
  }





  viewArticle(id) {
    const article = this.articles.find(a => a.id === id);
    if (article) {
      document.getElementById('modalTitle').textContent = 'Quote';
      document.getElementById('modalContent').innerHTML = `
        <div class="modal-article">
          
          <div class="modal-content-text">
            <div class="content-display">${this.normalizeContentLinks(article.content)}</div>
          </div>
          
        </div>
      `;
      
      // 更新来源信息
      const sourceText = document.getElementById('sourceText');
      const sourceUrl = article.from || article.url || '';
      if (sourceUrl) {
        const domain = this.getDomainFromUrl(sourceUrl);
        sourceText.textContent = `Source: ${domain}`;
        sourceText.parentElement.style.cursor = 'pointer';
        sourceText.parentElement.onclick = () => {
          window.open(sourceUrl, '_blank');
        };
      } else {
        sourceText.textContent = 'Source: Unknown';
        sourceText.parentElement.style.cursor = 'default';
        sourceText.parentElement.onclick = null;
      }
      
      this.currentModalContent = article.content;
      this.currentArticleId = id;
      // 重置编辑态与按钮显示
      const editorContainer = document.getElementById('editorContainer');
      if (editorContainer) editorContainer.classList.add('hidden');
      const contentDisplay = document.querySelector('#modalContent .content-display');
      // 查看详情时隐藏评论侧栏
      const commentsSection = document.querySelector('.comments-section');
      if (commentsSection) commentsSection.classList.add('hidden');
      if (contentDisplay) contentDisplay.classList.remove('hidden');
      document.getElementById('editContentBtn').classList.remove('hidden');
      document.getElementById('saveEditBtn').classList.add('hidden');
      document.getElementById('cancelEditBtn').classList.add('hidden');

      // 初始化批注交互
      this.initAnnotationFeature();

      this.showModal();
      // 加载评论
      this.loadComments(id);
    }
  }

  async copyArticle(id) {
    const article = this.articles.find(a => a.id === id);
    if (article) {
      try {
        await navigator.clipboard.writeText(article.content);
        this.showToast('Copied to clipboard.');
      } catch (error) {
        this.showToast('Copy failed', 'error');
      }
    }
  }

  async deleteArticle(id) {
    if (!confirm('Delete this item? It will be moved to Trash.')) {
      return;
    }

    try {
      const numericId = Number(id);
      // 检查是否在扩展环境中
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const response = await chrome.runtime.sendMessage({ 
          action: 'deleteArticle', 
          id: numericId 
        });
        
        if (response.success) {
          this.selectedArticles.delete(id);
          await this.loadArticles();
          this.renderCategories(); // 更新分类计数
          // 重新应用当前分类过滤，确保回收站视图正确刷新
          this.filterArticlesByCategory();
          this.closeModal(); // 关闭模态框
          this.showToast('Moved to Trash.');
        } else {
          this.showToast('Failed to delete article.', 'error');
        }
      } else {
        // 直接在数据库标记为删除（软删除）
        if (this.db) {
          const transaction = this.db.transaction(['articles'], 'readwrite');
          const store = transaction.objectStore('articles');
          await new Promise((resolve, reject) => {
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
              const article = getRequest.result;
              if (article) {
                article.deleted = true;
                article.deletedAt = new Date().toISOString();
                const putRequest = store.put(article);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
              } else {
                resolve();
              }
            };
            getRequest.onerror = () => reject(getRequest.error);
          });
          
          this.selectedArticles.delete(id);
          await this.loadArticles();
          this.renderCategories(); // 更新分类计数
          // 重新应用当前分类过滤
          this.filterArticlesByCategory();
          this.closeModal(); // 关闭模态框
          this.showToast('Moved to Trash');
        }
      }
    } catch (error) {
      this.showToast('Delete failed', 'error');
    }
  }

  // 永久删除（仅 Trash 视图）
  async deleteForever(id) {
    if (!confirm('This will permanently delete the item. Continue?')) {
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ action: 'deleteForever', id: Number(id) });
      if (response && response.success) {
        this.selectedArticles.delete(id);
        await this.loadArticles();
        this.renderCategories();
        this.filterArticlesByCategory();
        this.closeModal();
        this.showToast('Deleted permanently');
      } else {
        this.showToast('Delete failed', 'error');
      }
    } catch (err) {
      this.showToast('Delete failed', 'error');
    }
  }

  // 恢复（仅 Trash 视图）
  async restoreArticle(id) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'restoreArticle', id: Number(id) });
      if (response && response.success) {
        this.selectedArticles.delete(id);
        await this.loadArticles();
        this.renderCategories();
        this.filterArticlesByCategory();
        this.closeModal();
        this.showToast('Restored');
      } else {
        this.showToast('Restore failed', 'error');
      }
    } catch (err) {
      this.showToast('Restore failed', 'error');
    }
  }

  exportData() {
    const data = {
      version: '2.0',
      exportTime: new Date().toISOString(),
      categories: this.categories,
      articles: this.articles
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quotebox-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Save export history
    this.saveExportHistory(blob.size, this.articles.length);

    this.showToast('Exported successfully (categories and articles included).');
  }

  saveExportHistory(size, count) {
    const history = this.getExportHistory();
    history.unshift({
      time: Date.now(),
      size: size,
      count: count
    });
    // Keep last 20 records
    if (history.length > 20) history.pop();
    localStorage.setItem('quotebox_export_history', JSON.stringify(history));
  }

  getExportHistory() {
    try {
      return JSON.parse(localStorage.getItem('quotebox_export_history') || '[]');
    } catch (e) {
      return [];
    }
  }

  showExportHistory() {
    const history = this.getExportHistory();
    const container = document.getElementById('exportHistoryList');
    const modal = document.getElementById('exportHistoryModal');
    
    if (!container || !modal) return;
    
    if (history.length === 0) {
      container.innerHTML = '<div class="history-empty">No export history found.</div>';
    } else {
      let html = '<table class="history-table"><thead><tr><th>Time</th><th>Size</th><th>Articles</th></tr></thead><tbody>';
      history.forEach(item => {
        html += `<tr>
          <td>${new Date(item.time).toLocaleString()}</td>
          <td>${this.formatBytes(item.size)}</td>
          <td>${item.count}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    }
    
    modal.classList.remove('hidden');
  }

  formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  // 显示/关闭导出弹窗
  showExportModal() {
    const el = document.getElementById('exportModal');
    if (el) el.classList.remove('hidden');
  }
  closeExportModal() {
    const el = document.getElementById('exportModal');
    if (el) el.classList.add('hidden');
  }

  async importData(file) {
    if (!file) return;
    
    try {
      this.showLoading(true);
      const text = await file.text();
      const data = JSON.parse(text);
      
      // 验证数据格式
      if (!data.articles || !Array.isArray(data.articles)) {
        throw new Error('Invalid data format: missing articles.');
      }
      
      // 兼容旧版本数据格式
      if (!data.categories) {
        data.categories = [{ id: 1, name: 'Default', created_at: new Date().toISOString() }];
      }
      
      // 调用后台脚本导入数据
      const response = await chrome.runtime.sendMessage({
        action: 'importData',
        data: data
      });
      
      if (response.success) {
        this.showToast('Import successful. Refreshing...');
        
        // 延迟刷新页面以重新加载数据
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        throw new Error(response.error || 'Import failed');
      }
      
    } catch (error) {
      this.showToast('Import failed: ' + error.message, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // 导入弹窗控制
  showImportModal() {
    const el = document.getElementById('importModal');
    if (el) el.classList.remove('hidden');
  }
  closeImportModal() {
    const el = document.getElementById('importModal');
    if (el) el.classList.add('hidden');
  }

  // 清空回收站
  async emptyRecycleBin() {
    if (!confirm('Emptying Trash will permanently remove all items. Continue?')) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const response = await chrome.runtime.sendMessage({ action: 'emptyRecycleBin' });
        if (response.success) {
          await this.loadArticles();
          this.renderCategories();
          this.showToast('Trash emptied.');
        } else {
          this.showToast("Couldn’t empty Trash.", 'error');
        }
      } else {
        // 直接从本地 IndexedDB 清除 deleted=true 的记录
        if (this.db) {
          const transaction = this.db.transaction(['articles'], 'readwrite');
          const store = transaction.objectStore('articles');
          const request = store.getAll();
          const idsToDelete = await new Promise((resolve, reject) => {
            request.onsuccess = () => {
              const toDelete = request.result.filter(a => a.deleted).map(a => a.id);
              resolve(toDelete);
            };
            request.onerror = () => reject(request.error);
          });

          for (const id of idsToDelete) {
            await new Promise((resolve, reject) => {
              const delReq = store.delete(id);
              delReq.onsuccess = () => resolve();
              delReq.onerror = () => reject(delReq.error);
            });
          }
          await this.loadArticles();
          this.renderCategories();
          this.showToast('Trash emptied.');
        }
      }
    } catch (err) {
      this.showToast("Couldn’t empty Trash.", 'error');
    }
  }

  showModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('modal');
    
    modalOverlay.classList.remove('hidden');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  closeModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('modal');
    
    modalOverlay.classList.add('hidden');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    // 关闭弹窗时清理批注相关状态
    this.currentSelectionRange = null;
    this.targetAnnotationSpan = null;
    const tooltip = document.getElementById('selectionTooltip');
    const popup = document.getElementById('annotationPopup');
    if (tooltip) tooltip.classList.add('hidden');
    if (popup) popup.classList.add('hidden');
  }

  // 进入编辑模式
  enterEditMode() {
    try {
      const editorContainer = document.getElementById('editorContainer');
      const contentDisplay = document.querySelector('#modalContent .content-display');
      if (!editorContainer || !contentDisplay) return;

      // 初始化 Quill（如未初始化），使用统一的 toolbarOptions 配置
      if (!this.quill) {
        try {
          // 本地简版 Quill 仅支持数组容器的 toolbar 配置
          this.quill = new Quill('#editor', { theme: 'snow', modules: { toolbar: this.toolbarOptions } });
        } catch (err) {
          this.showToast('Editor failed to load.', 'error');
          return;
        }
      }

      // 将现有 HTML 内容写入编辑器，保留富文本格式
      this.quill.clipboard.dangerouslyPasteHTML(contentDisplay.innerHTML);

      // 切换显示
      editorContainer.classList.remove('hidden');
      contentDisplay.classList.add('hidden');
      // 隐藏旧的静态工具栏，使用模块化工具栏
      const staticToolbar = document.getElementById('editorToolbar');
      if (staticToolbar) staticToolbar.classList.add('hidden');
      document.getElementById('editContentBtn').classList.add('hidden');
      document.getElementById('saveEditBtn').classList.remove('hidden');
      document.getElementById('cancelEditBtn').classList.remove('hidden');
      // 填充编辑元信息（分类 + 标题）
      const titleInput = document.getElementById('editArticleTitle');
      const categorySelect = document.getElementById('editArticleCategory');
      const article = this.articles.find(a => a.id === this.currentArticleId);
      if (titleInput && article) {
        titleInput.value = article.title || '';
      }
      if (categorySelect) {
        // 渲染分类选项
        const categories = Array.isArray(this.categories) ? this.categories : [];
        categorySelect.innerHTML = categories.map(c => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`).join('');
        if (article) {
          const currentCatId = article.categoryId ?? article.category;
          if (currentCatId != null) {
            categorySelect.value = String(currentCatId);
          }
        }
      }
      // 编辑时隐藏评论侧栏
      const commentsSection = document.querySelector('.comments-section');
      if (commentsSection) commentsSection.classList.add('hidden');
      // 聚焦编辑器，方便立即操作工具栏
      this.quill.root.focus();
      this.isEditing = true;
    } catch (error) {
      this.showToast('Failed to enter edit mode.', 'error');
    }
  }

  setupEditorToolbar() {
    const toolbar = document.getElementById('editorToolbar');
    const editorEl = this.quill?.root || document.getElementById('editor');
    if (!toolbar || !editorEl) return;
    // 委托绑定
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.ql-btn');
      if (!btn) return;
      const cmd = btn.getAttribute('data-cmd');
      const value = btn.getAttribute('data-value');
      // 确保焦点在编辑器
      editorEl.focus();
      try {
        switch (cmd) {
          case 'bold':
          case 'italic':
          case 'underline':
            document.execCommand(cmd, false, null);
            break;
          case 'strikeThrough':
            document.execCommand('strikeThrough', false, null);
            break;
          case 'formatBlock':
            document.execCommand('formatBlock', false, value || 'P');
            break;
          case 'insertOrderedList':
            document.execCommand('insertOrderedList', false, null);
            break;
          case 'insertUnorderedList':
            document.execCommand('insertUnorderedList', false, null);
            break;
          case 'createLink':
            {
              const url = prompt('Enter link URL');
              if (url) document.execCommand('createLink', false, url);
            }
            break;
          case 'removeFormat':
            document.execCommand('removeFormat', false, null);
            break;
          default:
            break;
        }
      } catch (err) {
        // formatting command failed silently
      }
    });
  }

  // 取消编辑
  cancelEditMode() {
    const editorContainer = document.getElementById('editorContainer');
    const contentDisplay = document.querySelector('#modalContent .content-display');
    if (!editorContainer || !contentDisplay) return;
    editorContainer.classList.add('hidden');
    contentDisplay.classList.remove('hidden');
    document.getElementById('editContentBtn').classList.remove('hidden');
    document.getElementById('saveEditBtn').classList.add('hidden');
    document.getElementById('cancelEditBtn').classList.add('hidden');
    // 退出编辑时保持评论侧栏隐藏
    const commentsSection = document.querySelector('.comments-section');
    if (commentsSection) commentsSection.classList.add('hidden');
    this.isEditing = false;
  }

  // 保存编辑后的内容（保留富文本 HTML）
  async saveEditedContent() {
    if (!this.quill || !this.currentArticleId) return;
    const html = this.quill.root.innerHTML;
    try {
      await this.updateArticleContent(this.currentArticleId, html);
      // 更新本地缓存与显示
      const article = this.articles.find(a => a.id === this.currentArticleId);
      if (article) {
        article.content = html;
        // 读取并保存标题
        const titleInput = document.getElementById('editArticleTitle');
        if (titleInput) {
          const newTitle = titleInput.value.trim();
          if (newTitle !== (article.title || '')) {
            await this.updateArticleTitle(this.currentArticleId, newTitle);
            article.title = newTitle;
          }
        }
        // 读取并保存分类
        const categorySelect = document.getElementById('editArticleCategory');
        if (categorySelect) {
          const newCatId = parseInt(categorySelect.value, 10);
          const currentCatId = article.categoryId ?? article.category;
          if (!isNaN(newCatId) && newCatId !== currentCatId) {
            // 扩展环境：发送消息到后台
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              const resp = await new Promise((resolve, reject) => {
                try {
                  chrome.runtime.sendMessage({ action: 'updateArticleCategory', id: this.currentArticleId, category: newCatId }, (response) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                      return;
                    }
                    resolve(response);
                  });
                } catch (err) {
                  reject(err);
                }
              });
              if (!resp || !resp.success) throw new Error(resp?.error || 'Failed to update category');
            } else if (this.db) {
              await this.updateArticleCategory(this.currentArticleId, newCatId);
            }
            article.categoryId = newCatId;
            article.category = newCatId;
          }
        }
      }
      const contentDisplay = document.querySelector('#modalContent .content-display');
      if (contentDisplay) contentDisplay.innerHTML = html;
      this.showToast('Changes saved.');
      // 重新渲染列表以反映标题/分类变更
      this.renderArticles();
      this.cancelEditMode();
    } catch (error) {
      this.showToast('Save failed. Please try again.', 'error');
    }
  }

  // 更新文章内容到后台（IndexedDB）
  async updateArticleContent(id, content) {
    // 在扩展环境下通过后台脚本更新
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ action: 'updateArticleContent', id, content }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (response && response.success) {
              resolve(true);
            } else {
              reject(new Error(response?.error || 'Update failed'));
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    }
    // 预览/非扩展环境下，直接返回成功（已更新本地内存）
    return true;
  }

  // 更新文章标题到后台（IndexedDB）
  async updateArticleTitle(id, title) {
    // 在扩展环境下通过后台脚本更新
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ action: 'updateArticleTitle', id, title }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (response && response.success) {
              resolve(true);
            } else {
              reject(new Error(response?.error || 'Update failed'));
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    }
    // 预览/非扩展环境下，直接返回成功
    return true;
  }

  exportPdf() {
    if (!this.currentArticleId) return;
    
    const article = this.articles.find(a => a.id === this.currentArticleId);
    if (!article) return;
    
    const previewData = {
      title: article.title || 'Untitled',
      content: this.normalizeContentLinks(article.content),
      source: article.from || 'Unknown Source',
      date: article.create_at || new Date().toISOString()
    };
    
    localStorage.setItem('pdfPreviewData', JSON.stringify(previewData));
    
    // Open preview page in new tab
    window.open('pdf-preview.html', '_blank');
  }

  exportImage() {
    if (!this.currentArticleId) return;
    
    const article = this.articles.find(a => a.id === this.currentArticleId);
    if (!article) return;
    
    const previewData = {
      title: article.title || 'Untitled',
      content: this.normalizeContentLinks(article.content),
      source: article.from || 'Unknown Source',
      date: article.create_at || new Date().toISOString()
    };
    
    localStorage.setItem('imagePreviewData', JSON.stringify(previewData));
    
    // Open preview page in new tab
    window.open('image-preview.html', '_blank');
  }

  async copyModalHtml() {
    if (this.currentModalContent) {
      try {
        await navigator.clipboard.writeText(this.currentModalContent);
        this.showToast('HTML copied to clipboard.');
      } catch (error) {
        this.showToast('Copy failed', 'error');
      }
    }
  }

  async copyModalText() {
    if (this.currentModalContent) {
      try {
        // 创建临时元素来提取纯文本
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.currentModalContent;
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        await navigator.clipboard.writeText(textContent);
        this.showToast('Text copied to clipboard.');
      } catch (error) {
        this.showToast('Copy failed', 'error');
      }
    }
  }



  showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
      loading.classList.remove('hidden');
    } else {
      loading.classList.add('hidden');
    }
  }

  showError(message) {
    const container = document.getElementById('articleContainer');
    container.innerHTML = `
      <div class="error-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <h2>Load failed</h2>
        <p>${this.escapeHtml(message)}</p>
        <button id="retryBtn" class="btn">Retry</button>
      </div>
    `;
    const retryBtn = container.querySelector('#retryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => location.reload());
    }
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  // 工具函数
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // 从HTML内容中提取纯文本（不展示任何HTML标签）
  getPlainText(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = div.textContent || div.innerText || '';
    return text.replace(/\s+/g, ' ').trim();
  }

  // Get the first image src from HTML content
  getFirstImage(html) {
    if (!html) return null;
    const div = document.createElement('div');
    div.innerHTML = html;
    const img = div.querySelector('img');
    return img ? img.src : null;
  }

  // Normalize protocol-relative links (//...) to https for extension pages
  normalizeContentLinks(html) {
    if (!html) return '';
    try {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      const anchors = wrapper.querySelectorAll('a[href]');
      anchors.forEach(a => {
        const rawHref = a.getAttribute('href') || '';
        if (rawHref.startsWith('//')) {
          a.setAttribute('href', 'https:' + rawHref);
        }
        if (!a.getAttribute('target')) {
          a.setAttribute('target', '_blank');
        }
        const rel = a.getAttribute('rel');
        if (!rel) {
          a.setAttribute('rel', 'noopener noreferrer');
        }
      });
      return wrapper.innerHTML;
    } catch (e) {
      return html;
    }
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' minutes ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
    
    return date.toLocaleDateString('en-US');
  }

  formatFullDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US');
  }

  // 英文时间格式（仅用于卡片时间显示）
  formatDateEn(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' minutes ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';

    return date.toLocaleDateString('en-US');
  }

  formatFullDateEn(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US');
  }

  getDomainFromUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace('www.', '');
    } catch {
      return url;
    }
  }

  // 根据分类ID获取分类名称
  getCategoryNameById(categoryId) {
    const category = this.categories.find(cat => cat.id == categoryId);
    return category ? category.name : 'Default';
  }

  // 刷新当前已渲染卡片上的分类名称展示
  updateVisibleCardCategoryNames() {
    const tags = document.querySelectorAll('.card-category-tag');
    tags.forEach(tag => {
      const categoryId = tag.getAttribute('data-category-id');
      const nameEl = tag.querySelector('.category-name');
      if (nameEl) {
        const newName = this.getCategoryNameById(categoryId);
        nameEl.textContent = newName;
        nameEl.setAttribute('title', newName);
      }
    });
  }

  // 渲染分类列表
  renderCategories() {
    const container = document.getElementById('categoryContainer');
    const allCount = document.getElementById('allCount');
    const recycleCountEl = document.getElementById('recycleCount');
    
    // 更新全部分类的数量（不含已删除）
    const nonDeletedArticles = this.articles.filter(a => !a.deleted);
    allCount.textContent = nonDeletedArticles.length;
    // 更新回收站数量
    const recycleCount = this.articles.filter(a => a.deleted).length;
    if (recycleCountEl) recycleCountEl.textContent = recycleCount;
    
    // 计算每个分类的文章数量
    const categoryCounts = {};
    nonDeletedArticles.forEach(article => {
      // 支持按分类ID和分类名称计数
      const categoryId = article.categoryId || article.category;
      if (categoryId) {
        // 如果是数字ID，直接使用
        if (typeof categoryId === 'number') {
          categoryCounts[categoryId] = (categoryCounts[categoryId] || 0) + 1;
        } else {
          // 如果是分类名称，找到对应的ID
          const category = this.categories.find(c => c.name === categoryId);
          if (category) {
            categoryCounts[category.id] = (categoryCounts[category.id] || 0) + 1;
          }
        }
      }
    });
    
    container.innerHTML = this.categories.map(category => {
      const count = categoryCounts[category.id] || 0;
      return `
        <div class="category-item" data-category="${category.id}">
          <span class="category-name">${this.escapeHtml(category.name)}</span>
          <span class="category-count">${count}</span>
        </div>
      `;
    }).join('');
    
    // 绑定分类点击事件
    container.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', () => {
        const categoryId = item.dataset.category;
        this.selectCategory(categoryId);
      });
    });
    
    // 绑定全部分类点击事件
    document.querySelector('.category-item[data-category="all"]').addEventListener('click', () => {
      this.selectCategory('all');
    });
    // 绑定回收站点击事件
    const recycleItem = document.querySelector('.category-item[data-category="recycle"]');
    if (recycleItem) {
      recycleItem.addEventListener('click', () => {
        this.selectCategory('recycle');
      });
    }
  }

  // 选择分类
  selectCategory(categoryId) {
    this.currentCategory = categoryId;
    
    // 更新UI状态
    document.querySelectorAll('.category-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`[data-category="${categoryId}"]`).classList.add('active');
    
    // 过滤文章
    this.filterArticlesByCategory();
  }

  // 根据分类过滤文章
  filterArticlesByCategory() {
    if (this.currentCategory === 'all') {
      this.filteredArticles = this.articles.filter(a => !a.deleted);
    } else if (this.currentCategory === 'recycle') {
      this.filteredArticles = this.articles.filter(a => a.deleted);
    } else {
      // 根据分类过滤，且排除已删除
      this.filteredArticles = this.articles.filter(article => 
        article.categoryId == this.currentCategory && !article.deleted
      );
    }
    
    this.selectedArticles.clear();
    this.sortArticles();
    this.renderArticles();

  }

  // 显示分类管理弹窗
  showCategoryModal() {
    document.getElementById('categoryModal').classList.remove('hidden');
    this.renderManageCategories();
    document.getElementById('categoryNameInput').value = '';
    document.getElementById('categoryNameInput').focus();
  }

  // 关闭分类管理弹窗
  closeCategoryModal() {
    document.getElementById('categoryModal').classList.add('hidden');
  }

  // 分类重命名弹窗逻辑
  currentRenamingCategoryId = null;

  showCategoryRenameModal(id, currentName) {
    this.currentRenamingCategoryId = id;
    const input = document.getElementById('renameCategoryNameInput');
    input.value = currentName || '';
    document.getElementById('categoryRenameModal').classList.remove('hidden');
    input.focus();
    input.select();
  }

  closeCategoryRenameModal() {
    document.getElementById('categoryRenameModal').classList.add('hidden');
    this.currentRenamingCategoryId = null;
    const input = document.getElementById('renameCategoryNameInput');
    if (input) input.value = '';
  }

  async saveCategoryRename() {
    const id = this.currentRenamingCategoryId;
    const input = document.getElementById('renameCategoryNameInput');
    const newNameRaw = input?.value || '';
    const newName = newNameRaw.trim();

    if (!id) {
      this.showToast('Invalid category ID.', 'error');
      return;
    }
    if (!newName) {
      this.showToast('Please enter a category name.', 'error');
      return;
    }

    const current = this.categories.find(c => c.id === id);
    if (current && current.name === newName) {
      this.closeCategoryRenameModal();
      return;
    }

    if (this.categories.some(c => c.name === newName && c.id !== id)) {
      this.showToast('Category name already exists.', 'error');
      return;
    }

    try {
      await this.updateCategory(id, newName);
      this.showToast('Category updated.');
      this.closeCategoryRenameModal();
      // 重新渲染分类管理列表
      this.renderManageCategories();
      // 更新主视图分类列表与文章列表
      this.renderCategories();
      this.renderArticles();
    } catch (error) {
      this.showToast('Failed to update category.', 'error');
    }
  }

  // 渲染分类管理列表
  renderManageCategories() {
    const container = document.getElementById('manageCategoryList');
    
    container.innerHTML = this.categories.map(category => `
      <div class="manage-category-item" data-id="${category.id}" draggable="true">
        <div class="drag-handle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </div>
        <span class="manage-category-name">${this.escapeHtml(category.name)}</span>
        <div class="manage-category-actions">
          <button class="btn-edit" data-id="${category.id}" data-name="${this.escapeHtml(category.name)}">
            <i class="iconfont icon-edit-square"></i>
          </button>
          <button class="btn-delete" data-id="${category.id}">
            <i class="iconfont icon-delete"></i>
          </button>
        </div>
      </div>
    `).join('');
    
    // 绑定编辑和删除按钮事件
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget;
        const id = parseInt(targetBtn.dataset.id);
        const name = targetBtn.dataset.name;
        this.editCategory(id, name);
      });
    });
    
    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget;
        const id = parseInt(targetBtn.dataset.id);
        this.confirmDeleteCategory(id);
      });
    });
    
    // 绑定拖拽事件
    this.bindDragEvents(container);
  }

  // 绑定拖拽事件
  bindDragEvents(container) {
    let draggedElement = null;
    
    container.querySelectorAll('.manage-category-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        draggedElement = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      
      item.addEventListener('dragend', (e) => {
        item.classList.remove('dragging');
        draggedElement = null;
      });
      
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        if (draggedElement && draggedElement !== item) {
          const rect = item.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          
          if (e.clientY < midY) {
            item.classList.add('drag-over-top');
            item.classList.remove('drag-over-bottom');
          } else {
            item.classList.add('drag-over-bottom');
            item.classList.remove('drag-over-top');
          }
        }
      });
      
      item.addEventListener('dragleave', (e) => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over-top', 'drag-over-bottom');
        
        if (draggedElement && draggedElement !== item) {
          const draggedId = parseInt(draggedElement.dataset.id);
          const targetId = parseInt(item.dataset.id);
          const rect = item.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const insertBefore = e.clientY < midY;
          
          this.reorderCategories(draggedId, targetId, insertBefore);
        }
      });
    });
  }
  
  // 重新排序分类
  async reorderCategories(draggedId, targetId, insertBefore) {
    const draggedIndex = this.categories.findIndex(c => c.id === draggedId);
    const targetIndex = this.categories.findIndex(c => c.id === targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // 移动分类在数组中的位置
    const [draggedCategory] = this.categories.splice(draggedIndex, 1);
    const newTargetIndex = insertBefore ? targetIndex : targetIndex + 1;
    const adjustedIndex = draggedIndex < targetIndex && !insertBefore ? newTargetIndex - 1 : newTargetIndex;
    
    this.categories.splice(adjustedIndex, 0, draggedCategory);
    
    // 更新数据库中的排序
    await this.updateCategoryOrder();
    
    // 重新渲染分类列表和管理列表
    this.renderCategories();
    this.renderManageCategories();
  }
  
  // 更新分类排序到数据库
  async updateCategoryOrder() {
    try {
      const transaction = this.db.transaction(['categories'], 'readwrite');
      const store = transaction.objectStore('categories');
      
      // 更新每个分类的排序字段
      for (let i = 0; i < this.categories.length; i++) {
        const category = { ...this.categories[i], order: i };
        await store.put(category);
      }
      
      await transaction.complete;
    } catch (error) {
      this.showError('Failed to update category order.');
    }
  }

  // 处理添加分类
  async handleAddCategory() {
    const nameInput = document.getElementById('categoryNameInput');
    const name = nameInput.value.trim();
    
    if (!name) {
      this.showToast('Please enter a category name.', 'error');
      return;
    }
    
    // 检查分类名是否已存在
    if (this.categories.some(c => c.name === name)) {
      this.showToast('Category name already exists.', 'error');
      return;
    }
    
    try {
      await this.addCategory(name);
      nameInput.value = '';
      this.showToast('Category created.');
    } catch (error) {
      this.showToast('Failed to create category.', 'error');
    }
  }

  // 编辑分类
  editCategory(id, currentName) {
    // 使用自定义弹窗进行编辑，不使用原生 prompt
    this.showCategoryRenameModal(id, currentName);
  }

  // 确认删除分类
  confirmDeleteCategory(id) {
    const category = this.categories.find(c => c.id === id);
    if (category && confirm(`Delete category "${category.name}"? This can’t be undone.`)) {
      this.deleteCategory(id)
        .then(() => {
          this.showToast('Category deleted.');
        })
        .catch(error => {
          this.showToast('Failed to delete category.', 'error');
        });
    }
  }

  // 菜单相关方法
  toggleSettingsMenu() {
    const menu = document.getElementById('menuMenu');
    menu.classList.toggle('hidden');
  }

  hideSettingsMenu() {
    const menu = document.getElementById('menuMenu');
    menu.classList.add('hidden');
  }

  showAbout() {
    const aboutModal = document.getElementById('aboutModal');
    aboutModal.classList.remove('hidden');
  }

  closeAboutModal() {
    const aboutModal = document.getElementById('aboutModal');
    aboutModal.classList.add('hidden');
  }

  // 联系我们
  showContact() {
    const contactModal = document.getElementById('contactModal');
    contactModal.classList.remove('hidden');
  }

  closeContactModal() {
    const contactModal = document.getElementById('contactModal');
    contactModal.classList.add('hidden');
  }

  // 分类选择弹窗相关方法
  currentEditingArticle = null;
  selectedCategoryName = null;

  showCategoryEditModal(articleId, currentCategory) {
    this.currentEditingArticle = articleId;
    this.selectedCategoryName = currentCategory;
    this.renderCategoryList(currentCategory);
    document.getElementById('categoryModal').classList.remove('hidden');
  }

  closeCategoryEditModal() {
    document.getElementById('categoryModal').classList.add('hidden');
    this.currentEditingArticle = null;
    this.selectedCategoryName = null;
    document.getElementById('newCategoryInput').value = '';
  }

  confirmCategorySelection() {
    if (this.selectedCategoryName && this.currentEditingArticle) {
      this.selectCategoryForArticle(this.selectedCategoryName);
    } else {
      this.closeCategoryEditModal();
    }
  }

  renderCategoryList(currentCategory) {
    const categoryList = document.getElementById('categoryList');
    const categoryCount = {};
    
    // 统计每个分类的文章数量
    this.articles.forEach(article => {
      const category = article.category || 'Default';
      categoryCount[category] = (categoryCount[category] || 0) + 1;
    });

    // 添加"Default"选项
    const allCategories = ['Default', ...this.categories.map(c => c.name)];
    const uniqueCategories = [...new Set(allCategories)];

    categoryList.innerHTML = uniqueCategories.map(categoryName => {
      const count = categoryCount[categoryName] || 0;
      const isSelected = categoryName === currentCategory;
      return `
        <div class="category-option ${isSelected ? 'selected' : ''}" data-category="${this.escapeHtml(categoryName)}">
          <span class="category-option-name">${this.escapeHtml(categoryName)}</span>
          <span class="category-option-count">${count}</span>
        </div>
      `;
    }).join('');
  }

  async selectCategoryForArticle(categoryName) {
    if (!this.currentEditingArticle) return;

    try {
      // 更新文章分类
      const article = this.articles.find(a => a.id === this.currentEditingArticle);
      if (article) {
        const newCategory = categoryName === 'Default' ? '' : categoryName;
        article.category = newCategory;
        
        // 检查是否在扩展环境中
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          // 通过扩展API更新
          const response = await chrome.runtime.sendMessage({
            action: 'updateArticleCategory',
            id: this.currentEditingArticle,
            category: newCategory
          });
          
          if (!response.success) {
            throw new Error(response.error);
          }
        } else {
          // 直接更新数据库
          if (this.db) {
            await this.updateArticleCategory(this.currentEditingArticle, newCategory);
          }
          
          // 保存到localStorage
          const savedArticles = JSON.parse(localStorage.getItem('savedArticles') || '[]');
          const index = savedArticles.findIndex(a => a.id === this.currentEditingArticle);
          if (index !== -1) {
            savedArticles[index].category = article.category;
            localStorage.setItem('savedArticles', JSON.stringify(savedArticles));
          }
        }

        // 重新渲染
        await this.loadCategories();
        this.filterArticlesByCategory();
        this.renderArticles();
        
        this.showToast('Category updated.');
        this.closeCategoryEditModal();
      }
    } catch (error) {
      this.showToast('Failed to update category.', 'error');
    }
  }

  async createNewCategory() {
    const input = document.getElementById('newCategoryInput');
    const newCategoryName = input.value.trim();
    
    if (!newCategoryName) {
      this.showToast('Please enter a category name.', 'error');
      return;
    }

    if (this.categories.find(c => c.name === newCategoryName)) {
      this.showToast('Category name already exists.', 'error');
      return;
    }

    try {
      await this.addCategory(newCategoryName);
      await this.loadCategories();
      this.selectCategoryForArticle(newCategoryName);
    } catch (error) {
      this.showToast('Failed to create category.', 'error');
    }
  }

  // 显示卡片分类选择弹窗
  showCardCategoryModal(articleId) {
    this.currentEditingArticle = articleId;
    this.selectedCardCategoryId = null;
    
    // 渲染分类列表
    this.renderCardCategoryList();
    
    // 显示弹窗
    document.getElementById('cardCategoryModal').classList.remove('hidden');
  }
  
  // 关闭卡片分类选择弹窗
  closeCardCategoryModal() {
    document.getElementById('cardCategoryModal').classList.add('hidden');
    this.currentEditingArticle = null;
    this.selectedCardCategoryId = null;
  }
  
  // 渲染卡片分类列表
  renderCardCategoryList() {
    const container = document.getElementById('cardCategoryList');
    
    // 只显示实际分类，不包含"全部"选项
    const allCategories = this.categories;
    
    container.innerHTML = allCategories.map(category => `
      <div class="card-category-item" data-id="${category.id}">
        ${this.escapeHtml(category.name)}
      </div>
    `).join('');
    
    // 绑定点击事件
    container.querySelectorAll('.card-category-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 移除其他选中状态
        container.querySelectorAll('.card-category-item').forEach(i => i.classList.remove('selected'));
        // 添加选中状态
        item.classList.add('selected');
        // 记录选中的分类ID
        this.selectedCardCategoryId = parseInt(item.dataset.id);
      });
    });
  }
  
  // 确认卡片分类选择
  async confirmCardCategorySelection() {
    if (!this.currentEditingArticle || this.selectedCardCategoryId === null) {
      this.showToast('Please select a category.', 'error');
      return;
    }
    
    try {
      // 更新文章分类
        const article = this.articles.find(a => a.id === this.currentEditingArticle);
        if (article) {
          const newCategoryId = this.selectedCardCategoryId;
          article.category = newCategoryId;
          article.categoryId = newCategoryId;
        
        // 检查是否在扩展环境中
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          // 通过扩展API更新
          const response = await chrome.runtime.sendMessage({
            action: 'updateArticleCategory',
            id: this.currentEditingArticle,
            category: newCategoryId
          });
          
          if (!response.success) {
            throw new Error(response.error);
          }
        } else {
          // 直接更新数据库
          if (this.db) {
            await this.updateArticleCategory(this.currentEditingArticle, newCategoryId);
          }
          
          // 保存到localStorage
          const savedArticles = JSON.parse(localStorage.getItem('savedArticles') || '[]');
          const index = savedArticles.findIndex(a => a.id === this.currentEditingArticle);
          if (index !== -1) {
            savedArticles[index].category = newCategoryId;
            savedArticles[index].categoryId = newCategoryId;
            localStorage.setItem('savedArticles', JSON.stringify(savedArticles));
          }
        }
        
        // 重新渲染
        await this.loadCategories();
        this.filterArticlesByCategory();
        this.renderArticles();
        this.showToast('Category updated.');
        this.closeCardCategoryModal();
      }
    } catch (error) {
      this.showToast('Failed to update category.', 'error');
    }
  }

  // 更新文章分类
  async updateArticleCategory(articleId, newCategory) {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['articles'], 'readwrite');
    const store = transaction.objectStore('articles');
    
    // 先获取文章
    const getRequest = store.get(articleId);
    
    return new Promise((resolve, reject) => {
      getRequest.onsuccess = () => {
        const article = getRequest.result;
        if (article) {
          article.category = newCategory;
          
          const updateRequest = store.put(article);
          updateRequest.onsuccess = () => {
            // 更新本地数组
            const index = this.articles.findIndex(a => a.id === articleId);
            if (index !== -1) {
              this.articles[index].category = newCategory;
            }
            const filteredIndex = this.filteredArticles.findIndex(a => a.id === articleId);
            if (filteredIndex !== -1) {
              this.filteredArticles[filteredIndex].category = newCategory;
            }
            resolve();
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
      reject(new Error('Article not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // 评论相关方法
  currentArticleId = null;

  async submitComment() {
    const commentInput = document.getElementById('commentInput');
    const content = commentInput.value.trim();
    
    if (!content) {
      this.showToast('Please enter a comment.', 'error');
      return;
    }
    
    if (!this.currentArticleId) {
      this.showToast('Unable to get article info.', 'error');
      return;
    }
    
    try {
      const comment = {
        id: Date.now(),
        articleId: this.currentArticleId,
        content: content,
        createdAt: new Date().toISOString()
      };
      
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // 扩展环境
        const response = await chrome.runtime.sendMessage({
          action: 'addComment',
          comment: comment
        });
        
        if (response.success) {
          commentInput.value = '';
          this.loadComments(this.currentArticleId);
          this.showToast('Comment posted.');
        } else {
          this.showToast('Failed to post comment.', 'error');
        }
      } else {
        // 非扩展环境 - 暂时存储在内存中
        if (!this.comments) {
          this.comments = [];
        }
        this.comments.push(comment);
        commentInput.value = '';
        this.renderComments(this.comments.filter(c => c.articleId === this.currentArticleId));
        this.showToast('Comment posted.');
      }
    } catch (error) {
      this.showToast('Failed to post comment.', 'error');
    }
  }
  
  async loadComments(articleId) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // 扩展环境
        const response = await chrome.runtime.sendMessage({
          action: 'getComments',
          articleId: articleId
        });
        
        if (response.success) {
          this.renderComments(response.comments || []);
        }
      } else {
        // 非扩展环境
        const comments = (this.comments || []).filter(c => c.articleId === articleId);
        this.renderComments(comments);
      }
    } catch (error) {
      // ignore load comments error; UI will show empty
    }
  }
  
  renderComments(comments) {
    const commentsList = document.getElementById('commentsList');
    
    if (!comments || comments.length === 0) {
      commentsList.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 20px; font-size: 13px;">no comments yet</div>';
      return;
    }
    
    commentsList.innerHTML = comments.map(comment => `
      <div class="comment-item">
        <div class="comment-content">${this.escapeHtml(comment.content)}</div>
        <div class="comment-meta">
          <span class="comment-time">${this.formatDateEn(comment.createdAt)}</span>
          <button class="comment-delete-btn" data-comment-id="${comment.id}" title="Delete Comment">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3,6 5,6 21,6"></polyline>
              <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
    
    // 绑定删除按钮事件
    commentsList.querySelectorAll('.comment-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const commentId = parseInt(e.currentTarget.dataset.commentId);
        this.deleteComment(commentId);
      });
    });
  }

  async deleteComment(commentId) {
    if (!confirm('Delete this comment? This can’t be undone.')) {
      return;
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // 扩展环境
        const response = await chrome.runtime.sendMessage({
          action: 'deleteComment',
          commentId: commentId
        });
        
        if (response.success) {
          this.loadComments(this.currentArticleId);
          this.showToast('Comment deleted.');
        } else {
          this.showToast('Failed to delete comment.', 'error');
        }
      } else {
        // 非扩展环境
        if (this.comments) {
          this.comments = this.comments.filter(c => c.id !== commentId);
          this.renderComments(this.comments.filter(c => c.articleId === this.currentArticleId));
          this.showToast('Comment deleted.');
        }
      }
    } catch (error) {
      this.showToast('Failed to delete comment.', 'error');
    }
  }

  // ===== 批注功能 =====
  currentSelectionRange = null;
  targetAnnotationSpan = null;

  initAnnotationFeature() {
    const contentDisplay = document.querySelector('#modalContent .content-display');
    const modalContainer = document.querySelector('#modal .modal-container');
    if (!contentDisplay || !modalContainer) return;

    // 避免重复绑定
    if (contentDisplay.dataset.annotationBound === '1') return;
    contentDisplay.dataset.annotationBound = '1';

    // 选择结束显示tooltip：定位到选择文本的结束位置
    contentDisplay.addEventListener('mouseup', (e) => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          this.hideSelectionUI();
          return;
        }
        const range = sel.getRangeAt(0);
        const ancestor = range.commonAncestorContainer;
        const host = ancestor.nodeType === 1 ? ancestor : ancestor.parentNode;
        if (!contentDisplay.contains(host)) {
          this.hideSelectionUI();
          return;
        }
        this.currentSelectionRange = range.cloneRange();
        // 将位置固定到选区结束处，不跟随鼠标
        const endRange = range.cloneRange();
        endRange.collapse(false);
        const rect = endRange.getBoundingClientRect();
        const point = { x: rect.right, y: rect.bottom };
        this.showSelectionTooltip(point);
      }, 0);
    });

    // 点击已有批注显示弹窗
    contentDisplay.addEventListener('click', (e) => {
      const span = e.target.closest('.annotated-text');
      if (!span) return;
      e.stopPropagation();
      this.targetAnnotationSpan = span;
      const comments = this.getAnnotationComments(span);
      const rect = span.getBoundingClientRect();
      this.openAnnotationPopup(rect, comments);
    });

    // tooltip按钮与弹窗交互
    const commentBtn = document.getElementById('selectionCommentBtn');
    const popup = document.getElementById('annotationPopup');
    const confirmBtn = document.getElementById('annotationConfirmBtn');
    const cancelBtn = document.getElementById('annotationCancelBtn');
    const closeBtn = document.getElementById('annotationCloseBtn');

    if (commentBtn) {
      commentBtn.onclick = (e) => {
        e.stopPropagation();
        const tooltip = document.getElementById('selectionTooltip');
        if (!tooltip) return;
        const rect = tooltip.getBoundingClientRect();
        this.openAnnotationPopup(rect);
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        popup.classList.add('hidden');
        this.hideSelectionUI();
        this.targetAnnotationSpan = null;
      };
    }

    if (closeBtn) {
      closeBtn.onclick = () => {
        popup.classList.add('hidden');
        this.hideSelectionUI();
        this.targetAnnotationSpan = null;
      };
    }

    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        const input = document.getElementById('annotationInput');
        const text = (input?.value || '').trim();
        if (!text) {
          this.showToast('Please enter a comment', 'error');
          return;
        }
        try {
          // 将评论加入文章评论列表
          await this.submitCommentContent(text);
          // 添加或更新文本批注
          if (this.targetAnnotationSpan) {
            // 再次评论到已有批注
            const arr = this.getAnnotationComments(this.targetAnnotationSpan);
            arr.push(text);
            this.targetAnnotationSpan.dataset.comments = JSON.stringify(arr);
          } else {
            this.addAnnotationToSelection(text);
          }
          // 持久化内容（更新文章内容HTML）
          const contentDisplayEl = document.querySelector('#modalContent .content-display');
          if (contentDisplayEl && this.currentArticleId) {
            const newHtml = contentDisplayEl.innerHTML;
            await this.updateArticleContent(this.currentArticleId, newHtml);
          }
          this.showToast('Annotation added');
        } catch (err) {
          this.showToast('Failed to add annotation', 'error');
        } finally {
          input.value = '';
          popup.classList.add('hidden');
          this.hideSelectionUI();
          this.targetAnnotationSpan = null;
        }
      };
    }

    // 点击空白处隐藏UI
    document.addEventListener('click', (evt) => {
      const tooltip = document.getElementById('selectionTooltip');
      const ap = document.getElementById('annotationPopup');
      if (!tooltip || !ap) return;
      const tClick = evt.target.closest('#selectionTooltip');
      const pClick = evt.target.closest('#annotationPopup');
      const insideContent = evt.target.closest('#modalContent');
      if (!tClick && !pClick && !insideContent) {
        this.hideSelectionUI();
        ap.classList.add('hidden');
      }
    }, { once: false });
  }

  hideSelectionUI() {
    const tooltip = document.getElementById('selectionTooltip');
    if (tooltip) tooltip.classList.add('hidden');
    this.currentSelectionRange = null;
  }

  showSelectionTooltip(point) {
    // 按需隐藏选择浮层：选择文本时不显示 tooltip
    const tooltip = document.getElementById('selectionTooltip');
    if (tooltip) {
      tooltip.classList.add('hidden');
    }
  }

  openAnnotationPopup(fromRect, comments = []) {
    const popup = document.getElementById('annotationPopup');
    const container = document.querySelector('#modal .modal-container');
    if (!popup || !container) return;
    // 居中显示在详情弹窗中间
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    // 渲染批注评论列表
    this.renderAnnotationComments(comments);
    popup.classList.remove('hidden');
  }

  addAnnotationToSelection(firstComment) {
    if (!this.currentSelectionRange) return;
    const range = this.currentSelectionRange;
    const wrapper = document.createElement('span');
    wrapper.className = 'annotated-text';
    wrapper.dataset.comments = JSON.stringify([firstComment]);
    const frag = range.extractContents();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
    // 清理选择
    const sel = window.getSelection();
    sel?.removeAllRanges();
  }

  getAnnotationComments(span) {
    try {
      const raw = span?.dataset?.comments || '[]';
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  renderAnnotationComments(comments) {
    const listEl = document.getElementById('annotationCommentsList');
    if (!listEl) return;
    const arr = Array.isArray(comments) ? comments : [];
    if (arr.length === 0) {
      listEl.innerHTML = '<div style="text-align:center; color:#6c757d; font-size:12px; padding:8px 0;">No comments yet</div>';
      return;
    }
    listEl.innerHTML = arr.map(c => `<div class="comment-line">${this.escapeHtml(c)}</div>`).join('');
  }

  async submitCommentContent(content) {
    if (!content || !this.currentArticleId) {
      this.showToast('Unable to add comment.', 'error');
      return;
    }
    try {
      const comment = {
        id: Date.now(),
        articleId: this.currentArticleId,
        content: content,
        createdAt: new Date().toISOString()
      };
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const response = await chrome.runtime.sendMessage({
          action: 'addComment',
          comment
        });
        if (response.success) {
          await this.loadComments(this.currentArticleId);
        } else {
          this.showToast('Failed to post comment.', 'error');
        }
      } else {
        if (!this.comments) this.comments = [];
        this.comments.push(comment);
        this.renderComments(this.comments.filter(c => c.articleId === this.currentArticleId));
      }
    } catch (err) {
      this.showToast('Failed to post comment.', 'error');
    }
  }
}

// 页面加载完成后初始化
let optionsManager;
document.addEventListener('DOMContentLoaded', () => {
  optionsManager = new OptionsManager();
});

// 全局暴露optionsManager以供HTML中的onclick事件使用
window.optionsManager = optionsManager;
