/* Minimal local Quill stub: provides basic API used in options.js
 * - new Quill(selector, { theme })
 * - quill.clipboard.dangerouslyPasteHTML(html)
 * - quill.root.innerHTML
 * This is NOT full Quill. Replace with official Quill for full features.
 */
(function () {
  class Quill {
    constructor(selectorOrElement, options) {
      this.options = options || {};
      const el = typeof selectorOrElement === 'string'
        ? document.querySelector(selectorOrElement)
        : selectorOrElement;
      if (!el) throw new Error('Editor element not found');
      // Use target element as editable root
      el.contentEditable = true;
      el.classList.add('ql-editor');
      this.root = el;
      this.clipboard = {
        dangerouslyPasteHTML: (html) => {
          this.root.innerHTML = html || '';
        }
      };

      // Render toolbar if provided
      const modules = this.options.modules || {};
      if (modules.toolbar) {
        this._renderToolbar(modules.toolbar);
      }
    }

    _renderToolbar(toolbarConfig) {
      // Create toolbar container before editor
      const toolbar = document.createElement('div');
      toolbar.className = 'ql-toolbar ql-snow';
      const parent = this.root.parentElement;
      parent.insertBefore(toolbar, this.root);

      const makeButton = (label, dataset = {}) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ql-btn';
        btn.title = label;
        btn.innerHTML = getIconHTML(dataset.cmd || label, dataset.value);
        Object.keys(dataset).forEach(k => btn.dataset[k] = dataset[k]);
        return btn;
      };

      const makeSelect = (format, values) => {
        const sel = document.createElement('select');
        sel.className = 'ql-select';
        sel.dataset.format = format;
        values = Array.isArray(values) ? values : [];
        // Build defaults and labels
        let entries = [];
        if (format === 'font') {
          entries = [
            { value: '', label: 'Sans Serif' },
            { value: 'serif', label: 'Serif' },
            { value: 'monospace', label: 'Monospace' }
          ];
        } else if (format === 'size') {
          entries = [
            { value: '', label: 'Normal' },
            { value: 'small', label: 'Small' },
            { value: 'large', label: 'Large' },
            { value: 'huge', label: 'Huge' }
          ];
        } else if (format === 'header') {
          // 显示 H1–H6 与段落
          entries = (values.length ? values : [1, 2, 3, 4, 5, 6, false]).map(v => {
            if (v === false) return { value: '', label: 'Paragraph' };
            return { value: String(v), label: 'H' + String(v) };
          });
        } else {
          const defaults = {
            color: ['', '#000000', '#e03131', '#1971c2', '#2f9e44', '#fab005'],
            background: ['', '#ffffff', '#ffe3e3', '#e7f5ff', '#ebfbee', '#fff3bf'],
            align: ['', 'left', 'center', 'right', 'justify']
          };
          const vals = values.length ? values : (defaults[format] || []);
          entries = vals.map(v => ({ value: v === false ? '' : String(v), label: v === false ? 'default' : String(v) }));
        }
        // If explicit values provided, override defaults
        if (values.length) {
          if (format === 'size') {
            entries = values.map(v => ({ value: v === false ? '' : String(v), label: v === false ? 'Normal' : String(v) }));
          } else if (format === 'header') {
            entries = values.map(v => ({ value: v === false ? '' : String(v), label: v === false ? 'Paragraph' : 'H' + String(v) }));
          } else if (format === 'font') {
            entries = values.map(v => ({ value: String(v), label: String(v) }));
          }
        }
        entries.forEach(({ value, label }) => {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = label;
          sel.appendChild(opt);
        });
        return sel;
      };

      const getIconHTML = (cmd, val) => {
        // 使用 iconfont 的字体类作为所有 toolbar icon 的来源
        // 映射关系来源于 iconfont/iconfont.css
        const make = (name) => `<i class="iconfont ${name}"></i>`;
        switch (cmd) {
          case 'bold': return make('icon-bold');
          case 'italic': return make('icon-italic');
          case 'underline': return make('icon-underline');
          case 'strike': return make('icon-strikethrough');
          case 'undo': return make('icon-undo');
          case 'redo': return make('icon-redo');
          case 'color': return make('icon-font-colors');
          case 'background': return make('icon-editor-background-color');
          case 'blockquote': return make('icon-quote');
          case 'code-block': return make('icon-code');
          case 'clean': return make('icon-clear');
          case 'list':
            if (val === 'ordered') return make('icon-orderedlist');
            return make('icon-unorderedlist');
          case 'align':
            if (val === 'center') return make('icon-align-center');
            if (val === 'right') return make('icon-align-right');
            if (val === 'justify') return make('icon-align-left'); // iconfont 无 justify，使用左对齐替代
            return make('icon-align-left');
          case 'indent':
            if (val === '+1') return make('icon-indent');
            return make('icon-outdent');
          case 'link': return make('icon-link');
          case 'image': return make('icon-image');
          default:
            return cmd;
        }
      };

      const groups = Array.isArray(toolbarConfig) ? toolbarConfig : [];
      groups.forEach(group => {
        const span = document.createElement('span');
        span.className = 'ql-formats';
        group.forEach(item => {
          if (typeof item === 'string') {
            // simple command button
            span.appendChild(makeButton(item, { cmd: item }));
          } else if (typeof item === 'object') {
            const [key, value] = Object.entries(item)[0];
            // Special handling
            if (key === 'align' && Array.isArray(value)) {
              ['left', 'center', 'right', 'justify'].forEach(v => span.appendChild(makeButton('align', { cmd: 'align', value: v })));
            } else if (key === 'color' || key === 'background') {
              const btn = makeButton(key, { cmd: key });
              const input = document.createElement('input');
              input.type = 'color';
              input.className = 'ql-color-input';
              input.style.display = 'none';
              btn.addEventListener('click', () => input.click());
              input.addEventListener('input', () => exec(key, input.value));
              span.appendChild(btn);
              span.appendChild(input);
            } else if (Array.isArray(value)) {
              span.appendChild(makeSelect(key, value));
            } else {
              // specific buttons with value
              span.appendChild(makeButton(key, { cmd: key, value: value }));
            }
          }
        });
        toolbar.appendChild(span);
      });

      // Bind events
      const editorEl = this.root;
      const exec = (command, val = null) => {
        editorEl.focus();
        try {
          switch (command) {
            case 'bold':
            case 'italic':
            case 'underline':
              document.execCommand(command, false, null);
              break;
            case 'strike':
              document.execCommand('strikeThrough', false, null);
              break;
            case 'undo':
              document.execCommand('undo', false, null);
              break;
            case 'redo':
              document.execCommand('redo', false, null);
              break;
            case 'blockquote':
              document.execCommand('formatBlock', false, 'BLOCKQUOTE');
              break;
            case 'code-block':
              document.execCommand('formatBlock', false, 'PRE');
              break;
            case 'header':
              {
                const tag = val ? ('H' + val) : 'P';
                document.execCommand('formatBlock', false, tag);
              }
              break;
            case 'list':
              if (val === 'ordered') document.execCommand('insertOrderedList', false, null);
              else document.execCommand('insertUnorderedList', false, null);
              break;
            case 'script':
              if (val === 'sub') document.execCommand('subscript', false, null);
              else document.execCommand('superscript', false, null);
              break;
            case 'indent':
              if (val === '+1') document.execCommand('indent', false, null);
              else document.execCommand('outdent', false, null);
              break;
            case 'direction':
              editorEl.dir = (val === 'rtl') ? 'rtl' : '';
              break;
            case 'size':
              // Map to fontSize for basic levels
              const sizeMap = { small: '2', large: '5', huge: '7' };
              if (val && sizeMap[val]) document.execCommand('fontSize', false, sizeMap[val]);
              else document.execCommand('removeFormat', false, null);
              break;
            case 'color':
              if (val !== undefined) document.execCommand('foreColor', false, val || '#000000');
              break;
            case 'background':
              if (val !== undefined) document.execCommand('backColor', false, val || '#ffffff');
              break;
            case 'font':
              if (val) document.execCommand('fontName', false, val);
              else document.execCommand('removeFormat', false, null);
              break;
            case 'align':
              const map = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' };
              document.execCommand(map[val || 'left'], false, null);
              break;
            case 'link':
              {
                const url = prompt('Enter link URL');
                if (url) document.execCommand('createLink', false, url);
              }
              break;
            case 'image':
              {
                const url = prompt('Enter image URL');
                if (url) document.execCommand('insertImage', false, url);
              }
              break;
            case 'video':
              {
                const url = prompt('Enter video URL');
                if (url) {
                  const sel = window.getSelection();
                  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
                  const iframe = document.createElement('iframe');
                  iframe.src = url;
                  iframe.width = '100%';
                  iframe.height = '240';
                  iframe.setAttribute('frameborder', '0');
                  if (range) range.insertNode(iframe);
                  else editorEl.appendChild(iframe);
                }
              }
              break;
            case 'formula':
              alert('Formula input is not supported in the lite version. Please use full Quill.');
              break;
            case 'clean':
              document.execCommand('removeFormat', false, null);
              break;
            default:
              break;
          }
        } catch (e) {
        }
      };

      // Delegate events
      toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('button.ql-btn');
        if (!btn) return;
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.value;
        exec(cmd, val);
      });
      toolbar.addEventListener('change', (e) => {
        const sel = e.target.closest('select.ql-select');
        if (!sel) return;
        const format = sel.dataset.format;
        exec(format, sel.value);
      });
    }
  }
  window.Quill = Quill;
})();
