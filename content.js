// Content Script - 处理页面交互和通知

// 创建通知元素
function createNotification(message, type = 'success') {
  // 移除已存在的通知
  const existingNotification = document.getElementById('quotebox-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  // 创建新通知
  const notification = document.createElement('div');
  notification.id = 'quotebox-notification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#3e78f0' : '#f44336'};
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(62, 120, 240, 0.3);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 350px;
    word-wrap: break-word;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slideIn 0.3s ease-out;
  `;
  
  if (type === 'success') {
    notification.innerHTML = `
      <span>${message}</span>
      <span id="quotebox-view-now" style="cursor: pointer; text-decoration: underline; font-weight: 600; white-space: nowrap;">View Now</span>
    `;
    
    // Bind click event after adding to DOM
    setTimeout(() => {
      const viewBtn = document.getElementById('quotebox-view-now');
      if (viewBtn) {
        viewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'openHomePage' });
          // Remove notification immediately after clicking
          if (notification && notification.parentNode) {
            notification.remove();
          }
        });
      }
    }, 0);
  } else {
    notification.textContent = message;
  }
  
  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `;
  
  if (!document.getElementById('quotebox-styles')) {
    style.id = 'quotebox-styles';
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notification);
  
  // 3秒后自动消失
  setTimeout(() => {
    if (notification && notification.parentNode) {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (notification && notification.parentNode) {
          notification.remove();
        }
      }, 300);
    }
  }, 5000); // Extended to 5s to give user time to click
}

// 获取选中内容的HTML并尽可能保留原始样式（保留 style/class 等）
function getSelectedHTML() {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  
  // 定义需要保留的关键样式属性
  const styleProperties = [
    'color', 'background-color', 
    'font-size', 'font-family', 'font-weight', 
    'font-style', 'text-decoration', 'text-align', 
    'line-height'
  ];

  // 辅助函数：将计算样式内联到元素
  const inlineStyles = (root) => {
    const elements = [];
    // 如果根元素本身是元素节点，也包含进去
    if (root.nodeType === Node.ELEMENT_NODE) {
      elements.push(root);
    }
    // 获取所有子元素
    if (root.querySelectorAll) {
      elements.push(...root.querySelectorAll('*'));
    }

    const modifiedElements = [];

    elements.forEach(el => {
      // 检查元素是否在选区内（部分或全部）
      if (selection.containsNode(el, true)) {
        const computedStyle = window.getComputedStyle(el);
        const originalStyle = el.getAttribute('style');
        
        // 保存原始样式以便恢复
        modifiedElements.push({ element: el, originalStyle });
        
        // 应用关键样式
        styleProperties.forEach(prop => {
          el.style[prop] = computedStyle.getPropertyValue(prop);
        });
      }
    });

    return modifiedElements;
  };

  let modifiedElements = [];
  let html = '';

  try {
    // 1. 临时内联样式
    let container = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentNode;
    }
    
    modifiedElements = inlineStyles(container);

    // 2. 克隆内容（此时包含内联样式）
    const clonedSelection = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(clonedSelection);
    
    // 3. 清理HTML（保留style等属性）
    const sanitizeNode = (element) => {
      if (element.nodeType !== Node.ELEMENT_NODE) return;
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'script') {
        element.remove();
        return;
      }

      if (!(tagName === 'svg' || element.closest('svg'))) {
        const attributes = Array.from(element.attributes || []);
        attributes.forEach(attr => {
          const name = attr.name.toLowerCase();
          const value = attr.value || '';
          const isEvent = name.startsWith('on');
          const isDangerHref = name === 'href' && /^\s*javascript:/i.test(value);
          if (isEvent || isDangerHref) {
            element.removeAttribute(attr.name);
          }
        });
      }

      Array.from(element.childNodes).forEach(child => sanitizeNode(child));
    };

    sanitizeNode(div);
    html = div.innerHTML;

  } catch (error) {
  } finally {
    // 4. 恢复原始样式
    modifiedElements.forEach(({ element, originalStyle }) => {
      if (originalStyle === null) {
        element.removeAttribute('style');
      } else {
        element.setAttribute('style', originalStyle);
      }
    });
  }
  
  return html || null;
}

// 监听来自background script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showNotification') {
    createNotification(request.message, request.type);
    sendResponse({ success: true });
  } else if (request.action === 'getSelectedHTML') {
    const html = getSelectedHTML();
    const selection = window.getSelection();
    let innerText = '';
    try {
      if (selection && selection.rangeCount > 0) {
        // 优先使用 Selection 的字符串表示，接近 innerText
        innerText = selection.toString().trim();
        // 若需要更严格的 innerText，可用下面方式：
        // const frag = selection.getRangeAt(0).cloneContents();
        // const temp = document.createElement('div');
        // temp.appendChild(frag);
        // innerText = (temp.innerText || temp.textContent || '').trim();
      }
    } catch (e) {
      innerText = '';
    }
    sendResponse({ html, innerText });
  }
  return true;
});

// 监听文本选择事件（可选功能，用于增强用户体验）
document.addEventListener('mouseup', () => {
  const selectedText = window.getSelection().toString().trim();
  if (selectedText.length > 0) {
    // 可以在这里添加一些视觉提示，比如显示一个小按钮
    // 但为了简洁，我们暂时不实现这个功能
  }
});

// 防止重复加载
if (!window.quoteboxContentLoaded) {
  window.quoteboxContentLoaded = true;
}
