document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const articleId = parseInt(urlParams.get('id'), 10);

  let previewData = {};

  if (articleId) {
    try {
      const article = await getArticleFromDB(articleId);
      if (article) {
        previewData = {
          title: article.title || 'Untitled',
          content: normalizeContentLinks(article.content),
          source: article.from || 'Unknown Source',
          date: article.create_at || new Date().toISOString()
        };
      }
    } catch (e) {
      console.error('Failed to load article from DB', e);
      alert('Failed to load article content.');
    }
  } else {
    // Get content from localStorage
    previewData = JSON.parse(localStorage.getItem('imagePreviewData') || '{}');
  }
  
  if (previewData.content) {
    document.getElementById('articleContent').innerHTML = previewData.content;
  }
  
  if (previewData.title) {
    document.getElementById('articleTitle').textContent = previewData.title;
    document.title = previewData.title + ' - QuoteBox Image';
  }

  // Generate filename: quotebox-img-YYYYMMDDHHmmss.png
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const timestamp = 
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  
  const fileName = `quotebox-img-${timestamp}.png`;
  
  // Meta info hidden
  // const metaParts = [];
  // if (previewData.source) metaParts.push(`Source: ${previewData.source}`);
  // if (previewData.date) metaParts.push(`Date: ${new Date(previewData.date).toLocaleString()}`);
  // document.getElementById('articleMeta').textContent = metaParts.join(' | ');
  
  // Export button handler
  const exportBtn = document.getElementById('exportBtn');
  exportBtn.addEventListener('click', async () => {
    try {
      exportBtn.disabled = true;
      exportBtn.textContent = 'Generating...';
      
      const element = document.getElementById('captureContainer');
      
      // Use html2canvas to capture the element
      // scale: 2 for Retina/High DPI quality
      // useCORS: true to allow loading cross-origin images if possible
      // scrollY: -window.scrollY ensures we capture from the top even if scrolled
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        // windowWidth and windowHeight are not needed when min-height is auto
        // removing them ensures the canvas fits the content exactly
      });
      
      // Convert to blob and download
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        exportBtn.disabled = false;
        exportBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Export Image
        `;
      }, 'image/png');
      
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export Image';
    }
  });
});

function getArticleFromDB(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('QuoteBoxDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['articles'], 'readonly');
      const store = transaction.objectStore('articles');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    };
  });
}

function normalizeContentLinks(html) {
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
