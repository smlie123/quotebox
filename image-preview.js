document.addEventListener('DOMContentLoaded', () => {
  // Get content from localStorage
  const previewData = JSON.parse(localStorage.getItem('imagePreviewData') || '{}');
  
  if (previewData.content) {
    document.getElementById('articleContent').innerHTML = previewData.content;
  }
  
  let fileName = 'quotebox-export.png';
  if (previewData.title) {
    document.getElementById('articleTitle').textContent = previewData.title;
    document.title = previewData.title + ' - QuoteBox Image';
    // Sanitize filename
    fileName = previewData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.png';
  }
  
  const metaParts = [];
  if (previewData.source) metaParts.push(`Source: ${previewData.source}`);
  if (previewData.date) metaParts.push(`Date: ${new Date(previewData.date).toLocaleString()}`);
  
  document.getElementById('articleMeta').textContent = metaParts.join(' | ');
  
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
