(() => {
  const STORAGE_KEY = 'brew-ratio-recipes-v1';
  const MIN_STAGE_COUNT = 2;
  const MAX_STAGE_COUNT = 6;
  const DEFAULT_STAGE_VALUES = {
    2: [50, 50],
    3: [20, 30, 50],
    4: [25, 25, 25, 25],
    5: [20, 20, 20, 20, 20],
    6: [20, 20, 20, 20, 20, 20],
  };

  const form = document.querySelector('#recipe-form');
  const doseInput = document.querySelector('#dose');
  const ratioInput = document.querySelector('#ratio');
  const stageMode = document.querySelector('#stage-mode');
  const customCountField = document.querySelector('#custom-count-field');
  const customStageCount = document.querySelector('#custom-stage-count');
  const stageInputs = document.querySelector('#stage-inputs');
  const stageResults = document.querySelector('#stage-results');
  const totalWater = document.querySelector('#total-water');
  const formError = document.querySelector('#form-error');
  const savedList = document.querySelector('#saved-list');
  const savedCount = document.querySelector('#saved-count');
  const saveLabel = document.querySelector('#save-label');
  const saveAsNewButton = document.querySelector('#save-as-new');
  const toast = document.querySelector('#toast');
  const deleteDialog = document.querySelector('#delete-dialog');

  let currentRecipeId = null;
  let pendingDeleteId = null;
  let toastTimer = null;

  const formatNumber = (value) => Number(value).toFixed(1);
  const readNumber = (input) => Number.parseFloat(input.value);
  const clampStageCount = (value) => Math.min(MAX_STAGE_COUNT, Math.max(MIN_STAGE_COUNT, Number(value) || 4));
  const createId = () => window.crypto?.randomUUID?.() || `recipe-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function setError(message) {
    formError.textContent = message || '';
    formError.hidden = !message;
  }

  function getStageInputs() {
    return [...stageInputs.querySelectorAll('input[data-stage]')];
  }

  function getStageCount() {
    return stageMode.value === 'custom' ? clampStageCount(customStageCount.value) : clampStageCount(stageMode.value);
  }

  function getPresetStageValues(count) {
    return [...(DEFAULT_STAGE_VALUES[clampStageCount(count)] || [])];
  }

  function normalizeStageValues(values, count) {
    const normalized = Array.isArray(values) ? values.slice(0, count) : [];
    while (normalized.length < count) normalized.push(0);
    return normalized;
  }

  function createStageRow(value, index, total) {
    const row = document.createElement('div');
    const isLast = index === total - 1;
    const safeValue = Number.isFinite(Number(value)) ? value : '';
    row.className = 'stage-input-row';
    row.dataset.index = String(index);
    row.innerHTML = `
      <span class="stage-index">0${index + 1}</span>
      <span class="stage-line" aria-hidden="true"></span>
      <input data-stage type="number" inputmode="numeric" min="0" max="100" step="1" value="${safeValue}" ${isLast ? 'readonly aria-readonly="true" tabindex="-1"' : ''} aria-label="第${index + 1}段注水比例${isLast ? '，自动计算' : ''}" />
      <span class="stage-unit">%</span>
    `;
    row.querySelector('input').addEventListener('input', () => {
      syncFinalStage();
      calculate();
    });
    return row;
  }

  function syncFinalStage() {
    const inputs = getStageInputs();
    if (inputs.length < MIN_STAGE_COUNT) return;
    const finalInput = inputs[inputs.length - 1];
    const editableValues = inputs.slice(0, -1).map(readNumber);
    const hasInvalidValue = editableValues.some((value) => !Number.isFinite(value) || value < 0 || value > 100);
    const editableSum = editableValues.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    finalInput.value = !hasInvalidValue && editableSum <= 100 ? String(100 - editableSum) : '';
  }

  function renderStageInputs(values) {
    const count = getStageCount();
    const normalized = normalizeStageValues(values, count);
    stageInputs.replaceChildren(...normalized.map((value, index) => createStageRow(value, index, count)));
    customCountField.hidden = stageMode.value !== 'custom';
    syncFinalStage();
  }

  function changeStageMode() {
    const count = getStageCount();
    if (stageMode.value === 'custom') customStageCount.value = String(count);
    renderStageInputs(getPresetStageValues(count));
    calculate();
  }

  function changeCustomStageCount() {
    renderStageInputs(getPresetStageValues(getStageCount()));
    calculate();
  }

  function validate() {
    syncFinalStage();
    const dose = readNumber(doseInput);
    const ratio = readNumber(ratioInput);
    const percentages = getStageInputs().map(readNumber);
    const editableSum = percentages.slice(0, -1).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    if (!Number.isFinite(dose) || dose <= 0) return { message: '请输入大于 0 的咖啡粉重量。' };
    if (!Number.isFinite(ratio) || ratio <= 0) return { message: '请输入大于 0 的水粉比。' };
    if (percentages.length < MIN_STAGE_COUNT || percentages.length > MAX_STAGE_COUNT) return { message: '冲泡段数需要设置为 2 到 6 段。' };
    if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      return { message: editableSum > 100 ? '前面各段比例合计不能超过 100%。' : '每段比例需要在 0% 到 100% 之间。' };
    }
    if (percentages.some((value) => !Number.isInteger(value))) return { message: '分段比例请使用整数百分比，例如 20%，不要填写 20.5%。' };
    const sum = percentages.reduce((acc, value) => acc + value, 0);
    if (sum !== 100) return { message: `当前比例合计为 ${formatNumber(sum)}%，还需要调整到 100%。` };
    return { dose, ratio, percentages, total: dose * ratio };
  }

  function calculate() {
    const result = validate();
    if (result.message) {
      totalWater.textContent = '—';
      stageResults.innerHTML = '<div class="empty-state"><strong>等比例设置好，就能看到路线</strong><p>检查左侧参数和分段比例。</p></div>';
      setError(result.message);
      return null;
    }
    setError('');
    totalWater.textContent = formatNumber(result.total);
    let cumulative = 0;
    stageResults.innerHTML = result.percentages.map((percentage, index) => {
      const water = result.total * percentage / 100;
      cumulative += water;
      return `<div class="stage-result"><span class="stage-name">第${index + 1}段<small>${formatNumber(percentage)}%</small></span><span class="water-value">${formatNumber(water)}g</span><span class="cumulative">${formatNumber(cumulative)}g</span></div>`;
    }).join('');
    return result;
  }

  function recipeName() {
    const value = document.querySelector('#recipe-name')?.value?.trim();
    return value || `${formatNumber(readNumber(doseInput)).replace('.0', '')}g咖啡粉 / 1:${formatNumber(readNumber(ratioInput)).replace('.0', '')} / ${getStageInputs().length}段式`;
  }

  function loadRecipes() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function persistRecipes(recipes) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function updateSaveActions() {
    const hasCurrentRecipe = Boolean(currentRecipeId);
    saveLabel.textContent = hasCurrentRecipe ? '保存修改' : '保存为新配方';
    saveAsNewButton.hidden = !hasCurrentRecipe;
  }

  function renderSavedRecipes() {
    const recipes = loadRecipes();
    savedCount.textContent = `${recipes.length} 份`;
    if (!recipes.length) {
      savedList.innerHTML = '<div class="empty-state"><strong>还没有保存的配方</strong><p>把今天这杯的参数保存下来，下次直接载入。</p></div>';
      return;
    }
    savedList.innerHTML = recipes.map((recipe) => `
      <article class="recipe-card">
        <span class="recipe-dot" aria-hidden="true"></span>
        <h3 title="${escapeHtml(recipe.name)}">${escapeHtml(recipe.name)}</h3>
        <div class="recipe-card-meta"><span>${formatNumber(recipe.dose)}g 粉</span><span>1:${formatNumber(recipe.ratio).replace('.0', '')}</span><span>${recipe.percentages.length} 段</span></div>
        <div class="recipe-card-stat">${formatNumber(recipe.dose * recipe.ratio)}<small>g 总水量</small></div>
        <div class="recipe-card-actions">
          <button class="card-action" type="button" data-action="load" data-id="${recipe.id}">载入</button>
          <button class="card-action" type="button" data-action="copy" data-id="${recipe.id}">复制</button>
          <button class="card-action delete" type="button" data-action="delete" data-id="${recipe.id}">删除</button>
        </div>
      </article>
    `).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function buildRecipe(result, id) {
    return {
      id,
      name: recipeName(),
      dose: result.dose,
      ratio: result.ratio,
      percentages: result.percentages,
      updatedAt: new Date().toISOString(),
    };
  }

  function saveRecipe(event) {
    event.preventDefault();
    const result = calculate();
    if (!result) return;
    const recipes = loadRecipes();
    const isUpdate = Boolean(currentRecipeId);
    const recipe = buildRecipe(result, currentRecipeId || createId());
    const existingIndex = recipes.findIndex((item) => item.id === recipe.id);
    if (existingIndex >= 0) recipes[existingIndex] = recipe;
    else recipes.unshift(recipe);
    persistRecipes(recipes);
    currentRecipeId = recipe.id;
    renderSavedRecipes();
    updateSaveActions();
    showToast(isUpdate && existingIndex >= 0 ? '配方已更新' : '配方已保存为新配方');
  }

  function saveAsNewRecipe() {
    const result = calculate();
    if (!result) return;
    const recipes = loadRecipes();
    const recipe = buildRecipe(result, createId());
    recipes.unshift(recipe);
    persistRecipes(recipes);
    currentRecipeId = recipe.id;
    renderSavedRecipes();
    updateSaveActions();
    showToast('已另存为新配方');
  }

  function resetForm() {
    currentRecipeId = null;
    stageMode.value = '3';
    customStageCount.value = '4';
    document.querySelector('#recipe-name').value = '';
    renderStageInputs(getPresetStageValues(3));
    calculate();
    updateSaveActions();
    doseInput.focus();
    showToast('已恢复默认参数');
  }

  function setStageSelection(count) {
    const safeCount = clampStageCount(count);
    if (safeCount >= 2 && safeCount <= 5) {
      stageMode.value = String(safeCount);
    } else {
      stageMode.value = 'custom';
      customStageCount.value = String(safeCount);
    }
  }

  function loadRecipe(id, duplicate = false) {
    const recipe = loadRecipes().find((item) => item.id === id);
    if (!recipe) return;
    const percentages = Array.isArray(recipe.percentages) ? recipe.percentages : [];
    const count = clampStageCount(percentages.length);
    doseInput.value = recipe.dose;
    ratioInput.value = recipe.ratio;
    setStageSelection(count);
    renderStageInputs(normalizeStageValues(percentages, count));
    const nameField = document.querySelector('#recipe-name');
    if (nameField) nameField.value = duplicate ? `${recipe.name} 副本` : recipe.name;
    currentRecipeId = duplicate ? null : recipe.id;
    calculate();
    updateSaveActions();
    document.querySelector('#calculator').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(duplicate ? '已复制到计算区' : '已载入配方');
  }

  function requestDelete(id) {
    pendingDeleteId = id;
    deleteDialog.showModal();
  }

  function deleteRecipe() {
    if (!pendingDeleteId) return;
    const recipes = loadRecipes().filter((recipe) => recipe.id !== pendingDeleteId);
    persistRecipes(recipes);
    if (currentRecipeId === pendingDeleteId) {
      currentRecipeId = null;
      updateSaveActions();
    }
    pendingDeleteId = null;
    renderSavedRecipes();
    showToast('配方已删除');
  }

  function registerWebMcp() {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(modelContext.registerTool({
        name: 'calculate_brew_ratio',
        title: '计算咖啡注水量',
        description: '根据咖啡粉重量、水粉比和每段比例，计算总水量、本段注水量和累计注水量，并同步更新页面。',
        inputSchema: {
          type: 'object',
          properties: {
            dose: { type: 'number', description: '咖啡粉重量，单位克' },
            ratio: { type: 'number', description: '水粉比中的水侧数字，例如 15' },
            percentages: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 6, description: '每段比例，合计必须为 100，支持 2 到 6 段' }
          },
          required: ['dose', 'ratio', 'percentages'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          const values = input || {};
          if (!Number.isFinite(values.dose) || !Number.isFinite(values.ratio) || !Array.isArray(values.percentages)) {
            throw new Error('请提供有效的粉量、水粉比和分段比例。');
          }
          if (values.percentages.length < MIN_STAGE_COUNT || values.percentages.length > MAX_STAGE_COUNT) {
            throw new Error('分段比例需要设置为 2 到 6 段。');
          }
          doseInput.value = values.dose;
          ratioInput.value = values.ratio;
          setStageSelection(values.percentages.length);
          renderStageInputs(values.percentages);
          const result = calculate();
          if (!result) throw new Error(formError.textContent);
          return {
            totalWater: Number(formatNumber(result.total)),
            stages: result.percentages.map((percentage, index) => ({
              stage: index + 1,
              percentage,
              water: Number(formatNumber(result.total * percentage / 100))
            }))
          };
        }
      }, { signal: lifecycle.signal }));
    } catch {
      lifecycle.abort();
    }
  }

  doseInput.addEventListener('input', calculate);
  ratioInput.addEventListener('input', calculate);
  stageMode.addEventListener('change', changeStageMode);
  customStageCount.addEventListener('change', changeCustomStageCount);
  form.addEventListener('submit', saveRecipe);
  deleteDialog.addEventListener('close', () => {
    if (deleteDialog.returnValue === 'confirm') deleteRecipe();
    else pendingDeleteId = null;
  });
  savedList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'load') loadRecipe(id);
    if (action === 'copy') loadRecipe(id, true);
    if (action === 'delete') requestDelete(id);
  });

  renderStageInputs(getPresetStageValues(3));
  calculate();
  renderSavedRecipes();
  updateSaveActions();
  window.BrewRatio = { resetForm, saveAsNewRecipe };
  registerWebMcp();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}), { once: true });
  }
})();
