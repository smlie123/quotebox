// Content Script - 处理页面交互和通知

// 防止重复加载
if (!window.quoteboxContentLoaded) {
  window.quoteboxContentLoaded = true;

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
      background: ${type === 'error' ? '#f44336' : '#3e78f0'};
      color: white !important;
      padding: 12px 20px;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(62, 120, 240, 0.3);
      z-index: 2147483647;
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
        <span style="color: white !important;">${message}</span>
        <span id="quotebox-view-now" style="cursor: pointer; text-decoration: underline; font-weight: 600; white-space: nowrap; color: white !important;">View Now</span>
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

  // Helper to find image element in the DOM by URL (robust against relative paths)
  function findImageElement(url) {
    if (!url) return null;
    
    // 1. Try exact attribute match (fastest)
    let img = document.querySelector(`img[src="${url.replace(/"/g, '\\"')}"]`);
    if (img) return img;
    
    // 2. Match by absolute URL property
    try {
        const targetUrl = new URL(url, window.location.href).href;
        // Iterate all images to check resolved .src property
        const allImages = document.getElementsByTagName('img');
        for (let i = 0; i < allImages.length; i++) {
            if (allImages[i].src === targetUrl) {
                return allImages[i];
            }
        }
    } catch (e) {
        // Invalid URL, ignore
    }
    
    return null;
  }

  // Image Capturer Utility
  const ImageCapturer = {
    // Convert Blob to Data URL
    blobToDataURL(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    // Strategy 1: Fetch in Content Script
    async captureByFetch(url) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Fetch failed');
        const blob = await response.blob();
        return {
          blob,
          dataUrl: await this.blobToDataURL(blob),
          method: 'fetch'
        };
      } catch (err) {
        throw err;
      }
    },

    // Strategy 2: Canvas Draw
    async captureByCanvas(imgElement) {
      return new Promise((resolve, reject) => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = imgElement.naturalWidth || imgElement.width;
          canvas.height = imgElement.naturalHeight || imgElement.height;
          const ctx = canvas.getContext('2d');
          
          // Try to handle CORS if possible (requires 'crossOrigin' attr on original img or new Image)
          // Since we are using existing imgElement, it might already be tainted.
          // Let's create a new Image to try with crossOrigin anonymous
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = imgElement.src;
          
          img.onload = () => {
            try {
              ctx.drawImage(img, 0, 0);
              const dataUrl = canvas.toDataURL('image/png');
              resolve({
                dataUrl,
                method: 'canvas'
              });
            } catch (e) {
              reject(e); // Likely TaintedCanvas error
            }
          };
          img.onerror = () => reject(new Error('Image load error'));
        } catch (e) {
          reject(e);
        }
      });
    },

    // Strategy 3: SVG foreignObject (DOM Cloning)
    async captureBySVG(imgElement) {
      // This is often blocked by CSP or same-origin policies for internal resources,
      // but useful if we want to capture the "rendered" state.
      // Note: This returns a rasterized image of the element.
      return new Promise((resolve, reject) => {
        try {
          const width = imgElement.naturalWidth || imgElement.width || 100;
          const height = imgElement.naturalHeight || imgElement.height || 100;
          
          const xmlns = "http://www.w3.org/2000/svg";
          const svg = document.createElementNS(xmlns, "svg");
          svg.setAttribute("width", width);
          svg.setAttribute("height", height);
          
          const foreignObject = document.createElementNS(xmlns, "foreignObject");
          foreignObject.setAttribute("width", "100%");
          foreignObject.setAttribute("height", "100%");
          
          // Clone the image node
          const clone = imgElement.cloneNode(true);
          clone.removeAttribute('crossorigin'); // Reset to avoid double handling
          // We must ensure the style allows it to be visible
          clone.style.margin = '0';
          clone.style.display = 'block';
          
          foreignObject.appendChild(clone);
          svg.appendChild(foreignObject);
          
          const svgData = new XMLSerializer().serializeToString(svg);
          const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(svgBlob);
          
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            try {
              const dataUrl = canvas.toDataURL('image/png');
              resolve({
                dataUrl,
                method: 'svg'
              });
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
          };
          img.src = url;
        } catch (e) {
          reject(e);
        }
      });
    },

    // Strategy 4: Background Proxy (Bypass CORS)
    async captureByBackground(url) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchImageBlob', url }, (response) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          if (response && response.success && response.dataUrl) {
            resolve({
              dataUrl: response.dataUrl,
              method: 'background'
            });
          } else {
            reject(new Error(response?.error || 'Background fetch failed'));
          }
        });
      });
    },
    
    async captureByScreenshot(imgElement) {
      return new Promise(async (resolve, reject) => {
        try {
          if (!imgElement) return reject(new Error('No image element'));
          
          const initialScrollX = window.scrollX;
          const initialScrollY = window.scrollY;
          
          const rect = imgElement.getBoundingClientRect();
          const pageLeft = rect.left + window.scrollX;
          const pageTop = rect.top + window.scrollY;
          const vw = window.innerWidth || document.documentElement.clientWidth || 0;
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          const dpr = window.devicePixelRatio || 1;
          
          const totalWidth = Math.round(rect.width * dpr);
          const totalHeight = Math.round(rect.height * dpr);
          const canvas = document.createElement('canvas');
          canvas.width = totalWidth;
          canvas.height = totalHeight;
          const ctx = canvas.getContext('2d');
          
          let coveredHeight = 0;
          while (coveredHeight < rect.height) {
            const targetScrollY = pageTop + coveredHeight;
            window.scrollTo(initialScrollX, targetScrollY);
            
            await new Promise(r => setTimeout(r, 80));
            await new Promise(r => requestAnimationFrame(r));
            
            const r2 = imgElement.getBoundingClientRect();
            const left = Math.max(0, r2.left);
            const top = Math.max(0, r2.top);
            const right = Math.min(vw, r2.right);
            const bottom = Math.min(vh, r2.bottom);
            const width = Math.max(0, right - left);
            const height = Math.max(0, bottom - top);
            if (width === 0 || height === 0) break;
            
            const resp = await new Promise((res, rej) => {
              chrome.runtime.sendMessage({
                action: 'captureAndCrop',
                rect: { left, top, width, height },
                dpr
              }, (response) => {
                if (chrome.runtime.lastError) return rej(chrome.runtime.lastError);
                if (!response || !response.success || !response.dataUrl) {
                  return rej(new Error(response && response.error ? response.error : 'Screenshot crop failed'));
                }
                res(response);
              });
            });
            
            const segmentImg = await new Promise((res, rej) => {
              const im = new Image();
              im.onload = () => res(im);
              im.onerror = rej;
              im.src = resp.dataUrl;
            });
            
            const destX = Math.round((left - rect.left) * dpr);
            const destY = Math.round(((window.scrollY - pageTop) + top) * dpr);
            ctx.drawImage(segmentImg, 0, 0, Math.round(width * dpr), Math.round(height * dpr), destX, destY, Math.round(width * dpr), Math.round(height * dpr));
            
            coveredHeight = Math.min(rect.height, coveredHeight + height);
          }
          
          window.scrollTo(initialScrollX, initialScrollY);
          
          const dataUrl = canvas.toDataURL('image/png');
          resolve({ dataUrl, method: 'screenshot-stitch' });
        } catch (e) {
          reject(e);
        }
      });
    },

    // Main Capture Method
    async capture(src, imgElement = null) {
      const errors = [];
      
      // 1. Try Fetch (Fastest & Best Quality)
      try {
        return await this.captureByFetch(src);
      } catch (e) {
        errors.push(`Fetch: ${e.message}`);
      }
      
      // 2. Try Background (Strongest for CORS)
      // We prioritize background over Canvas/SVG because Canvas often gets tainted
      // and SVG has issues with external resources inside foreignObject.
      try {
        return await this.captureByBackground(src);
      } catch (e) {
        errors.push(`Background: ${e.message}`);
      }
      
      // 3. Try Canvas (If imgElement exists)
      if (imgElement) {
        try {
          return await this.captureByCanvas(imgElement);
        } catch (e) {
          errors.push(`Canvas: ${e.message}`);
        }
        
        // 4. Try SVG (Last Resort)
        try {
          return await this.captureBySVG(imgElement);
        } catch (e) {
          errors.push(`SVG: ${e.message}`);
        }
        
        try {
          return await this.captureByScreenshot(imgElement);
        } catch (e) {
          errors.push(`Screenshot: ${e.message}`);
        }
      }

      // Fallback: Return original URL if all fail
      console.warn('Image capture failed, using original URL:', errors);
      return {
        src,
        dataUrl: src, // Just return the src as dataUrl-like (it's not base64 but it is a valid src)
        method: 'fallback'
      };
    }
  };

  // Helper to process images in HTML string
  async function processImagesInHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));
    
    if (images.length === 0) return html;

    // Process all images in parallel
    await Promise.all(images.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      
      // Resolve relative URLs
      const absoluteSrc = new URL(src, window.location.href).href;
      
      try {
        // Try to find original element in DOM to pass to capture
        const originalImg = findImageElement(absoluteSrc);
        
        const result = await ImageCapturer.capture(absoluteSrc, originalImg);
        
        if (result.dataUrl && result.dataUrl.startsWith('data:')) {
          img.setAttribute('src', result.dataUrl);
          img.setAttribute('data-original-src', absoluteSrc); // Keep original trace
          img.setAttribute('data-capture-method', result.method);
        } else {
            img.setAttribute('src', absoluteSrc);
        }
      } catch (e) {
        // Keep original src if fail, but make absolute
        img.setAttribute('src', absoluteSrc);
      }
    }));
    
    return doc.body.innerHTML;
  }

  // 监听来自background script的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showNotification') {
      createNotification(request.message, request.type);
      sendResponse({ success: true });
    } else if (request.action === 'getSelectedHTML') {
      // Async handling for getSelectedHTML
      (async () => {
        const html = getSelectedHTML();
        const selection = window.getSelection();
        let innerText = '';
        try {
          if (selection && selection.rangeCount > 0) {
            innerText = selection.toString().trim();
          }
        } catch (e) {
          innerText = '';
        }
        
        // Process images if HTML exists
        let processedHtml = html;
        if (html) {
            try {
                processedHtml = await processImagesInHTML(html);
            } catch (err) {
                console.error('Image processing failed:', err);
            }
        }

        // Check payload size to prevent "Message exceeded maximum allowed size" error
        // Chrome limit is 64MB, safety margin set to ~20MB (10M chars)
        const SAFE_LIMIT = 10 * 1024 * 1024;
        if (processedHtml && processedHtml.length > SAFE_LIMIT) {
          console.warn('Processed HTML too large to save');
          createNotification('Content too large! Please save in smaller batches.', 'error');
          sendResponse({ html: null, innerText: '', error: 'Content too large' });
        } else {
          sendResponse({ html: processedHtml, innerText });
        }
      })();
      return true; // Keep channel open
    } else if (request.action === 'captureImage') {
      // New action for context menu "image"
      createNotification('Saving image...', 'info');
      (async () => {
        try {
          const { srcUrl } = request;
          // Find element if possible
          const imgElement = findImageElement(srcUrl);
          const result = await ImageCapturer.capture(srcUrl, imgElement);
          sendResponse({ success: true, data: result });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }
    return true;
  });

  // 监听文本选择事件（可选功能，用于增强用户体验）
  document.addEventListener('mouseup', () => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText.length > 0) {
      // 可以在这里添加一些视觉提示，比如显示一个小按钮
    }
  });
}
