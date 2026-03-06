const DAEMON_BASE = 'http://127.0.0.1:4317';
const originalTextMap = new Map();
let immersionEnabled = true;
let popupElement = null;

function isEligibleTextNode(node) {
  if (!node || !node.nodeValue) return false;
  const text = node.nodeValue.trim();
  if (!text) return false;
  if (text.length < 4) return false;
  const parent = node.parentElement;
  if (!parent) return false;

  const excludedTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'];
  if (excludedTags.includes(parent.tagName)) return false;
  if (parent.closest('.korean-immersion-popup')) return false;

  return /[A-Za-z]/.test(text);
}

function collectTextNodes(limit = 120) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode() && nodes.length < limit) {
    const node = walker.currentNode;
    if (isEligibleTextNode(node)) {
      nodes.push(node);
    }
  }
  return nodes;
}

async function translateSentence(text) {
  const response = await fetch(`${DAEMON_BASE}/v1/translate/sentence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error('Translation failed');
  }

  return response.json();
}

async function applyImmersionOverlay() {
  const nodes = collectTextNodes();
  for (const node of nodes) {
    if (!immersionEnabled) {
      return;
    }

    if (originalTextMap.has(node)) {
      continue;
    }

    const original = node.nodeValue;
    originalTextMap.set(node, original);

    try {
      const result = await translateSentence(original);
      node.nodeValue = result.koreanSentence;
    } catch {
      // If daemon is unavailable, keep original text.
      originalTextMap.delete(node);
    }
  }
}

function restoreOriginalText() {
  for (const [node, original] of originalTextMap.entries()) {
    node.nodeValue = original;
  }
  originalTextMap.clear();
}

function clearPopup() {
  if (popupElement) {
    popupElement.remove();
    popupElement = null;
  }
}

async function lookupText(text) {
  const query = encodeURIComponent(text);
  const response = await fetch(`${DAEMON_BASE}/v1/vocab/lookup?text=${query}`);
  if (!response.ok) {
    throw new Error('Lookup failed');
  }
  return response.json();
}

async function translateToEnglish(text) {
  const response = await fetch(`${DAEMON_BASE}/v1/translate/to-english`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error('English translation failed');
  }

  return response.json();
}

function containsHangul(text) {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(text);
}

async function saveText(payload) {
  const response = await fetch(`${DAEMON_BASE}/v1/vocab/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error('Save failed');
  }
  return response.json();
}

function showPopup({ text, meaning, exampleKo, x, y }) {
  clearPopup();

  const popup = document.createElement('div');
  popup.className = 'korean-immersion-popup';
  popup.style.position = 'fixed';
  popup.style.left = `${x}px`;
  popup.style.top = `${y + 8}px`;
  popup.style.zIndex = '2147483647';
  popup.style.background = '#f6f8f3';
  popup.style.border = '1px solid #8fa594';
  popup.style.borderRadius = '8px';
  popup.style.padding = '10px';
  popup.style.width = '280px';
  popup.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
  popup.style.fontFamily = "'SF Mono', Menlo, monospace";
  popup.innerHTML = `
    <div style="font-weight:bold; margin-bottom:6px;">${text}</div>
    <div style="font-size:12px; margin-bottom:6px;">Meaning (English)</div>
    <input id="korean-meaning-input" value="${(meaning || 'Add English meaning note').replace(/"/g, '&quot;')}" style="width:100%; margin-bottom:8px;" />
    <div style="font-size:12px; margin-bottom:6px; color:#334;">${exampleKo || 'No example stored yet.'}</div>
    <button id="korean-save-btn" style="width:100%; background:#2f6f4f; color:#fff; border:none; border-radius:6px; padding:6px; cursor:pointer;">Save to Vocabulary</button>
    <button id="korean-close-btn" style="width:100%; margin-top:6px; border:1px solid #999; border-radius:6px; padding:6px; background:white; cursor:pointer;">Close</button>
  `;

  popup.querySelector('#korean-close-btn').addEventListener('click', clearPopup);
  popup.querySelector('#korean-save-btn').addEventListener('click', async () => {
    const meaningInput = popup.querySelector('#korean-meaning-input');
    const meaningValue = meaningInput.value.trim() || 'Captured meaning';
    try {
      await saveText({
        text,
        meaning: meaningValue,
        exampleKo: exampleKo || `${text}를 복습합니다.`,
        source: 'extension_popup'
      });
      popup.querySelector('#korean-save-btn').textContent = 'Saved';
    } catch {
      popup.querySelector('#korean-save-btn').textContent = 'Save failed';
    }
  });

  document.body.appendChild(popup);
  popupElement = popup;
}

async function handleSelection(event) {
  const selectedText = String(window.getSelection()?.toString() || '').trim();
  if (!selectedText || selectedText.length < 1) {
    return;
  }

  try {
    const lookup = await lookupText(selectedText);
    let englishMeaning = (lookup.meaning || '').trim();

    if (!englishMeaning || containsHangul(englishMeaning)) {
      const english = await translateToEnglish(englishMeaning || selectedText);
      englishMeaning = (english.englishText || '').trim() || englishMeaning;
    }

    showPopup({
      text: selectedText,
      meaning: englishMeaning,
      exampleKo: lookup.exampleKo || '',
      x: event.clientX,
      y: event.clientY
    });
  } catch {
    try {
      const english = await translateToEnglish(selectedText);
      showPopup({
        text: selectedText,
        meaning: (english.englishText || '').trim(),
        exampleKo: '',
        x: event.clientX,
        y: event.clientY
      });
    } catch {
      showPopup({
        text: selectedText,
        meaning: '',
        exampleKo: '',
        x: event.clientX,
        y: event.clientY
      });
    }
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'IMMERSION_TOGGLE') {
    immersionEnabled = Boolean(message.enabled);
    if (immersionEnabled) {
      applyImmersionOverlay();
    } else {
      restoreOriginalText();
      clearPopup();
    }
  }
});

chrome.storage.local.get(['immersionEnabled'], (result) => {
  immersionEnabled = result.immersionEnabled !== false;
  if (immersionEnabled) {
    applyImmersionOverlay();
  }
});

document.addEventListener('mouseup', (event) => {
  handleSelection(event).catch(() => {
    // no-op
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    clearPopup();
  }
});
