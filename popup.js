// JavaScript logic for Popup page

class PopupManager {
  constructor() {
    this.articles = [];
    this.filteredArticles = [];
    this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadArticles();
  }

  bindEvents() {
    // View More button
    document.getElementById('viewMoreBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openHomePage' });
    });
  }

  async loadArticles() {
    this.showLoading(true);
    
    try {
      let articles = [];
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const response = await chrome.runtime.sendMessage({ action: 'getAllArticles' });
        if (!response.success) throw new Error(response.error || 'unknown error');
        articles = response.data || [];
      } else {
        // Local preview fallback: read from localStorage
        const saved = JSON.parse(localStorage.getItem('savedArticles') || '[]');
        articles = Array.isArray(saved) ? saved : [];
      }
      this.articles = articles.sort((a, b) => new Date(b.create_at) - new Date(a.create_at));
      // Show only the 5 most recently saved items
      this.filteredArticles = this.articles.slice(0, 5);
      this.renderArticles();
    } catch (error) {
      this.showError('Failed to load data. Please try again.');
    } finally {
      this.showLoading(false);
    }
  }



  renderArticles() {
    const container = document.getElementById('articleList');
    const emptyState = document.getElementById('emptyState');
    
    if (this.filteredArticles.length === 0) {
      container.innerHTML = '';
      container.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }
    
    container.classList.remove('hidden');
    emptyState.classList.add('hidden');
    
    container.innerHTML = this.filteredArticles.map(article => `
      <div class="article-item" data-id="${article.id}">
        <div class="article-content">
          <p class="content-text">${this.removeImages(article.content)}</p>
        </div>
      </div>
    `).join('');
    
    // Bind action button events
    this.bindArticleEvents();
  }

  bindArticleEvents() {
    // Copy button
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        this.copyArticle(id);
      });
    });

    // Delete button
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        this.deleteArticle(id);
      });
    });

    // Click article item to jump to options page
    document.querySelectorAll('.article-item').forEach(item => {
      item.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openHomePage' });
      });
    });
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
    if (!confirm('Delete this item? This can’t be undone.')) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'deleteArticle', 
        id: id 
      });
      
      if (response.success) {
        this.articles = this.articles.filter(a => a.id !== id);
        this.filteredArticles = this.filteredArticles.filter(a => a.id !== id);
        this.renderArticles();
        this.showToast('Deleted.');
      } else {
        this.showToast('Delete failed', 'error');
      }
    } catch (error) {
      this.showToast('Delete failed', 'error');
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
    const container = document.getElementById('articleList');
    container.innerHTML = `
      <div class="error-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <h3>Load failed</h3>
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
    }, 2000);
  }

  // Utility functions
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  removeImages(htmlContent) {
    // Create temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    
    // 检查是否只包含img标签（图片内容）
    const images = tempDiv.querySelectorAll('img');
    const hasOnlyImage = images.length > 0 && tempDiv.textContent.trim() === '';
    
    if (hasOnlyImage) {
      // 如果是纯图片内容，保留img标签并设置样式
      images.forEach(img => {
        img.style.height = '50px';
        img.style.width = 'auto';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '4px';
      });
      return tempDiv.innerHTML;
    } else {
      // 如果是文本内容，移除所有img标签，返回纯文本
      images.forEach(img => img.remove());
      return tempDiv.textContent || tempDiv.innerText || '';
    }
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
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

  getDomainFromUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace('www.', '');
    } catch {
      return 'Unknown source';
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 设置窗口大小
  // document.body.style.width = '400px';
  // document.body.style.height = '600px';
  
  // 初始化PopupManager
  new PopupManager();
});
