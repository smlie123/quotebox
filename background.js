// 初始化IndexedDB数据库
class QuoteBoxDB {
  constructor() {
    this.dbName = 'QuoteBoxDB';
    this.version = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;
        
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
        
        // 数据迁移：从旧的quotebox数据库迁移数据
        if (oldVersion < 2) {
          this.migrateFromOldDatabase();
        }
      };
    });
  }
  
  async migrateFromOldDatabase() {
    try {
      const oldRequest = indexedDB.open('quotebox', 1);
      oldRequest.onsuccess = () => {
        const oldDb = oldRequest.result;
        if (oldDb.objectStoreNames.contains('article')) {
          const transaction = oldDb.transaction(['article'], 'readonly');
          const store = transaction.objectStore('article');
          const getAllRequest = store.getAll();
          
          getAllRequest.onsuccess = () => {
            const articles = getAllRequest.result;
            // 将文章数据迁移到新数据库
            articles.forEach(article => {
              this.saveArticle(article.content, article.from, article.category || '');
            });
            
            // 删除旧数据库
            oldDb.close();
            indexedDB.deleteDatabase('quotebox');
          };
        }
      };
    } catch (error) {
    }
  }

  async saveArticle(content, from, categoryId = 1, title = undefined) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      
      const article = {
        content: content,
        create_at: new Date().toISOString(),
        from: from,
        categoryId: categoryId  // 使用categoryId字段存储分类ID
      };
      if (title && typeof title === 'string' && title.trim().length > 0) {
        article.title = title.trim();
      }
      
      const request = store.add(article);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllArticles() {
    if (!this.db) await this.init();
    // 清理超过保留期的回收站数据
    await this.cleanRecycleBin();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readonly');
      const store = transaction.objectStore('articles');
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteArticle(id) {
    if (!this.db) await this.init();
    
    // 软删除：标记为 deleted 并记录时间
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
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
  }

  // 恢复文章：取消删除标记
  async restoreArticle(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const article = getRequest.result;
        if (article) {
          article.deleted = false;
          delete article.deletedAt;
          const putRequest = store.put(article);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // 永久删除文章（从数据库删除记录）
  async deleteForever(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      const delReq = store.delete(id);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error);
    });
  }

  async updateArticleContent(id, content) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const article = getRequest.result;
        if (article) {
          article.content = content;
          const putRequest = store.put(article);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
      reject(new Error('Article not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async updateArticleTitle(id, title) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const article = getRequest.result;
        if (article) {
          article.title = title;
          const putRequest = store.put(article);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
      reject(new Error('Article not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // Clean up expired items in trash (>24 hours)
  async cleanRecycleBin() {
    if (!this.db) await this.init();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const toDelete = (getAllReq.result || []).filter(a => a.deleted && a.deletedAt && new Date(a.deletedAt).getTime() < cutoff);
        let remaining = toDelete.length;
        if (remaining === 0) return resolve();
        toDelete.forEach(a => {
          const delReq = store.delete(a.id);
          delReq.onsuccess = () => {
            remaining -= 1;
            if (remaining === 0) resolve();
          };
          delReq.onerror = () => reject(delReq.error);
        });
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    });
  }

  // 清空回收站（永久删除 deleted=true 的数据）
  async emptyRecycleBin() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const toDelete = (getAllReq.result || []).filter(a => a.deleted);
        let remaining = toDelete.length;
        if (remaining === 0) return resolve();
        toDelete.forEach(a => {
          const delReq = store.delete(a.id);
          delReq.onsuccess = () => {
            remaining -= 1;
            if (remaining === 0) resolve();
          };
          delReq.onerror = () => reject(delReq.error);
        });
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    });
  }

  async updateArticleCategory(id, categoryId) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['articles'], 'readwrite');
      const store = transaction.objectStore('articles');
      
      // 先获取文章
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const article = getRequest.result;
        if (article) {
          article.categoryId = categoryId;
          const putRequest = store.put(article);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
      reject(new Error('Article not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async getAllCategories() {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories'], 'readonly');
      const store = transaction.objectStore('categories');
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async addCategory(name) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories'], 'readwrite');
      const store = transaction.objectStore('categories');
      
      const category = {
        name: name,
        created_at: new Date().toISOString()
      };
      
      const request = store.add(category);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async updateCategory(id, name) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories'], 'readwrite');
      const store = transaction.objectStore('categories');
      
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const category = getRequest.result;
        if (category) {
          category.name = name;
          const putRequest = store.put(category);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
      reject(new Error('Category not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deleteCategory(id) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories'], 'readwrite');
      const store = transaction.objectStore('categories');
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async importData(data) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['categories', 'articles'], 'readwrite');
      const categoryStore = transaction.objectStore('categories');
      const articleStore = transaction.objectStore('articles');
      
      // 清空现有数据
      const clearCategories = categoryStore.clear();
      const clearArticles = articleStore.clear();
      
      Promise.all([clearCategories, clearArticles]).then(() => {
        // 导入分类数据
        if (data.categories && Array.isArray(data.categories)) {
          data.categories.forEach(category => {
            categoryStore.add(category);
          });
        }
        
        // 导入文章数据
        if (data.articles && Array.isArray(data.articles)) {
          data.articles.forEach(article => {
            articleStore.add(article);
          });
        }
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }).catch(error => reject(error));
    });
  }

  // 评论相关方法
  async addComment(comment) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['comments'], 'readwrite');
      const store = transaction.objectStore('comments');
      
      const commentData = {
        articleId: comment.articleId,
        content: comment.content,
        createdAt: comment.createdAt || new Date().toISOString()
      };
      
      const request = store.add(commentData);
      request.onsuccess = () => resolve({ success: true, id: request.result });
      request.onerror = () => reject(request.error);
    });
  }

  async getComments(articleId) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['comments'], 'readonly');
      const store = transaction.objectStore('comments');
      const index = store.index('articleId');
      
      const request = index.getAll(articleId);
      request.onsuccess = () => {
        const comments = request.result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        resolve(comments);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteComment(commentId) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['comments'], 'readwrite');
      const store = transaction.objectStore('comments');
      
      const request = store.delete(commentId);
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () => reject(request.error);
    });
  }

  async getAllCommentCounts() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['comments'], 'readonly');
      const store = transaction.objectStore('comments');
      const request = store.getAll(); 
      request.onsuccess = () => {
        const comments = request.result;
        const counts = {};
        comments.forEach(c => {
          counts[c.articleId] = (counts[c.articleId] || 0) + 1;
        });
        resolve(counts);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

const quoteBoxDB = new QuoteBoxDB();

// 插件安装时初始化
chrome.runtime.onInstalled.addListener(async () => {
  // 初始化数据库
  await quoteBoxDB.init();
  
  // 创建统一的右键菜单
  chrome.contextMenus.create({
    id: 'saveToQuoteBox',
    title: 'Save to QuoteBox',
    contexts: ['selection', 'image']
  });
});

// 处理右键菜单点击事件
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'saveToQuoteBox') {
    // 优先处理图片
    if (info.mediaType === 'image' && info.srcUrl) {
      try {
        // 保存为图片标签（使用原始图片 URL，不转换为 base64）
        const imageTag = `<img src="${info.srcUrl}" alt="" style="max-width: 100%; height: auto;" />`;
        
        // 内容与标题均设置为图片标签，便于在列表和弹窗中展示图片缩略图
        await quoteBoxDB.saveArticle(imageTag, tab.url, undefined, imageTag);
        
        // Notify other parts of the extension to refresh
        try {
          chrome.runtime.sendMessage({ action: 'refreshArticles' }).catch(() => {
            // Ignore error if no listeners are active
          });
        } catch (e) {
          // Ignore
        }

        // 通知用户保存成功
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'showNotification',
            message: 'Saved to QuoteBox.'
          });
        } catch (notificationError) {}
      } catch (error) {
        
        
        // 通知用户保存失败
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'showNotification',
            message: 'Save failed. Please try again.',
            type: 'error'
          });
        } catch (notificationError) {}
      }
    } 
    // 处理文本
    else if (info.selectionText) {
      try {
        let contentToSave = info.selectionText; // 默认使用纯文本
        let contentType = 'Plain Text';
        
        let titleText = '';
        try {
          // 尝试请求content script获取选中内容的HTML与innerText
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'getSelectedHTML'
          });

          
          
          if (response && response.html) {
            contentToSave = response.html;
            contentType = 'HTML';
          }
          const rawText = (response && response.innerText) ? response.innerText : (info.selectionText || '');
          titleText = rawText.replace(/\s+/g, ' ').trim().slice(0, 50);
        } catch (contentScriptError) {
          // 继续使用纯文本保存，不抛出错误
          const rawText = info.selectionText || '';
          titleText = rawText.replace(/\s+/g, ' ').trim().slice(0, 50);
        }
        
        
        
        // 保存选中的内容到数据库（包含标题）
        await quoteBoxDB.saveArticle(contentToSave, tab.url, undefined, titleText);
        
        // Notify other parts of the extension to refresh
        try {
          chrome.runtime.sendMessage({ action: 'refreshArticles' }).catch(() => {
            // Ignore error if no listeners are active
          });
        } catch (e) {
          // Ignore
        }

        // 尝试通知用户保存成功
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'showNotification',
            message: 'Saved to QuoteBox.'
          });
        } catch (notificationError) {
          // 可以考虑使用chrome.notifications API作为备选
        }
      } catch (error) {
        
        
        // 尝试通知用户保存失败
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'showNotification',
            message: 'Save failed. Please try again.',
            type: 'error'
          });
        } catch (notificationError) {}
      }
    }
  }
});

// 处理来自popup和options页面的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getAllArticles':
          const articles = await quoteBoxDB.getAllArticles();
          sendResponse({ success: true, data: articles });
          break;
          
        case 'deleteArticle':
          await quoteBoxDB.deleteArticle(Number(request.id));
          sendResponse({ success: true });
          break;
        
        case 'restoreArticle':
          await quoteBoxDB.restoreArticle(Number(request.id));
          sendResponse({ success: true });
          break;
        
        case 'deleteForever':
          await quoteBoxDB.deleteForever(Number(request.id));
          sendResponse({ success: true });
          break;
        
        case 'updateArticleContent':
          await quoteBoxDB.updateArticleContent(Number(request.id), request.content);
          sendResponse({ success: true });
          break;
        
        case 'updateArticleTitle':
          await quoteBoxDB.updateArticleTitle(Number(request.id), request.title);
          sendResponse({ success: true });
          break;
          
        case 'updateArticleCategory':
          await quoteBoxDB.updateArticleCategory(Number(request.id), Number(request.category));
          sendResponse({ success: true });
          break;
          
        case 'getAllCategories':
          const categories = await quoteBoxDB.getAllCategories();
          sendResponse({ success: true, data: categories });
          break;
          
        case 'addCategory':
          const categoryId = await quoteBoxDB.addCategory(request.name);
          sendResponse({ success: true, data: categoryId });
          break;
          
        case 'updateCategory':
          await quoteBoxDB.updateCategory(request.id, request.name);
          sendResponse({ success: true });
          break;
          
        case 'deleteCategory':
          await quoteBoxDB.deleteCategory(request.id);
          sendResponse({ success: true });
          break;
          
        case 'importData':
          await quoteBoxDB.importData(request.data);
          sendResponse({ success: true });
          break;

        case 'emptyRecycleBin':
          await quoteBoxDB.emptyRecycleBin();
          sendResponse({ success: true });
          break;
          
        case 'addComment':
          const commentResult = await quoteBoxDB.addComment(request.comment);
          sendResponse({ success: true, data: commentResult });
          break;
          
        case 'getComments':
          const comments = await quoteBoxDB.getComments(Number(request.articleId));
          sendResponse({ success: true, comments: comments });
          break;
          
        case 'deleteComment':
          await quoteBoxDB.deleteComment(Number(request.commentId));
          sendResponse({ success: true });
          break;

        case 'getAllCommentCounts':
          const counts = await quoteBoxDB.getAllCommentCounts();
          sendResponse({ success: true, counts: counts });
          break;
          
        case 'openHomePage':
          // Singleton pattern: open or focus home.html
          const homeUrl = chrome.runtime.getURL('home.html');
          chrome.tabs.query({}, (tabs) => {
            // Use startsWith to handle potential query parameters or hashes
            const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(homeUrl));
            if (existingTab) {
              chrome.tabs.update(existingTab.id, { active: true });
              chrome.windows.update(existingTab.windowId, { focused: true });
            } else {
              chrome.tabs.create({ url: homeUrl });
            }
          });
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // 保持消息通道开放
});

// 导出数据库实例供其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { quoteBoxDB };
}
