document.addEventListener('DOMContentLoaded', () => {
  // Get content from localStorage
  const previewData = JSON.parse(localStorage.getItem('pdfPreviewData') || '{}');
  
  if (previewData.content) {
    document.getElementById('articleContent').innerHTML = previewData.content;
  }
  
  if (previewData.title) {
    document.getElementById('articleTitle').textContent = previewData.title;
    document.title = previewData.title + ' - QuoteBox PDF';
  }
  
  const metaParts = [];
  if (previewData.source) metaParts.push(`Source: ${previewData.source}`);
  if (previewData.date) metaParts.push(`Date: ${new Date(previewData.date).toLocaleString()}`);
  
  document.getElementById('articleMeta').textContent = metaParts.join(' | ');
  
  // Print button handler
  document.getElementById('printBtn').addEventListener('click', () => {
    window.print();
  });
});
