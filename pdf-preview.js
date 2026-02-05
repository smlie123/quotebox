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
    // Fallback to localStorage (legacy)
    previewData = JSON.parse(localStorage.getItem('pdfPreviewData') || '{}');
  }

  if (previewData.content) {
    document.getElementById('articleContent').innerHTML = previewData.content;
  }
  
  if (previewData.title) {
    document.getElementById('articleTitle').textContent = previewData.title;
    document.title = previewData.title + ' - QuoteBox PDF';
  }
  
  // Meta info hidden
  // const metaParts = [];
  // if (previewData.source) metaParts.push(`Source: ${previewData.source}`);
  // if (previewData.date) metaParts.push(`Date: ${new Date(previewData.date).toLocaleString()}`);
  // document.getElementById('articleMeta').textContent = metaParts.join(' | ');
  
  // Print button handler
  document.getElementById('printBtn').addEventListener('click', () => {
    window.print();
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
