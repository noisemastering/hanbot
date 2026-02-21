// components/FlowModal.js
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

function FlowModal({ flow, intents, onClose, onSave }) {
  const { t } = useTranslation();

  const INPUT_TYPES = [
    { value: 'text', label: t('flowModal.inputTypeText') },
    { value: 'options', label: t('flowModal.inputTypeOptions') },
    { value: 'number', label: t('flowModal.inputTypeNumber') },
    { value: 'phone', label: t('flowModal.inputTypePhone') },
    { value: 'email', label: t('flowModal.inputTypeEmail') },
    { value: 'confirm', label: t('flowModal.inputTypeConfirm') }
  ];

  const COMPLETE_ACTIONS = [
    { value: 'message', label: t('flowModal.actionMessage') },
    { value: 'handoff', label: t('flowModal.actionHandoff') },
    { value: 'flow', label: t('flowModal.actionFlow') },
    { value: 'intent', label: t('flowModal.actionIntent') }
  ];
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState({
    key: '',
    name: '',
    description: '',
    triggerIntent: '',
    steps: [],
    onComplete: {
      action: 'message',
      message: '',
      handoffReason: '',
      includeVariables: [],
      nextFlow: '',
      triggerIntent: ''
    },
    active: true,
    timeout: 30
  });
  const [expandedStep, setExpandedStep] = useState(null);

  useEffect(() => {
    if (flow) {
      setFormData({
        key: flow.key || '',
        name: flow.name || '',
        description: flow.description || '',
        triggerIntent: flow.triggerIntent || '',
        steps: flow.steps || [],
        onComplete: flow.onComplete || {
          action: 'message',
          message: '',
          handoffReason: '',
          includeVariables: [],
          nextFlow: '',
          triggerIntent: ''
        },
        active: flow.active !== undefined ? flow.active : true,
        timeout: flow.timeout || 30
      });
    }
  }, [flow]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.key || !formData.name) {
      alert(t('flowModal.errorKeyName'));
      return;
    }
    if (formData.steps.length === 0) {
      alert(t('flowModal.errorNoSteps'));
      return;
    }
    onSave(formData);
  };

  // Step management
  const addStep = () => {
    const newStep = {
      stepId: `step_${Date.now()}`,
      order: formData.steps.length + 1,
      message: '',
      collectAs: '',
      inputType: 'text',
      options: [],
      validation: { required: true },
      nextStep: ''
    };
    setFormData({ ...formData, steps: [...formData.steps, newStep] });
    setExpandedStep(newStep.stepId);
  };

  const updateStep = (stepId, updates) => {
    const newSteps = formData.steps.map(s =>
      s.stepId === stepId ? { ...s, ...updates } : s
    );
    setFormData({ ...formData, steps: newSteps });
  };

  const deleteStep = (stepId) => {
    const newSteps = formData.steps.filter(s => s.stepId !== stepId);
    // Re-order
    newSteps.forEach((s, i) => s.order = i + 1);
    setFormData({ ...formData, steps: newSteps });
  };

  const moveStep = (stepId, direction) => {
    const idx = formData.steps.findIndex(s => s.stepId === stepId);
    if ((direction === -1 && idx === 0) || (direction === 1 && idx === formData.steps.length - 1)) {
      return;
    }
    const newSteps = [...formData.steps];
    const temp = newSteps[idx];
    newSteps[idx] = newSteps[idx + direction];
    newSteps[idx + direction] = temp;
    // Re-order
    newSteps.forEach((s, i) => s.order = i + 1);
    setFormData({ ...formData, steps: newSteps });
  };

  // Options management for a step
  const addOption = (stepId) => {
    const step = formData.steps.find(s => s.stepId === stepId);
    if (!step) return;

    const newOption = { label: '', value: '', nextStep: '' };
    updateStep(stepId, { options: [...(step.options || []), newOption] });
  };

  const updateOption = (stepId, optionIdx, updates) => {
    const step = formData.steps.find(s => s.stepId === stepId);
    if (!step) return;

    const newOptions = [...step.options];
    newOptions[optionIdx] = { ...newOptions[optionIdx], ...updates };
    updateStep(stepId, { options: newOptions });
  };

  const deleteOption = (stepId, optionIdx) => {
    const step = formData.steps.find(s => s.stepId === stepId);
    if (!step) return;

    const newOptions = step.options.filter((_, i) => i !== optionIdx);
    updateStep(stepId, { options: newOptions });
  };

  // Collect variables for onComplete
  const collectedVariables = formData.steps
    .filter(s => s.collectAs)
    .map(s => s.collectAs);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">
            {flow ? t('flowModal.edit') : t('flows.addFlow')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-700 px-6">
          <div className="flex space-x-4">
            {['basic', 'steps', 'complete'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 px-1 border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-primary-500 text-white'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                {tab === 'basic' ? t('flowModal.basicTab') : tab === 'steps' ? `${t('flowModal.stepsTab')} (${formData.steps.length})` : t('flowModal.completeTab')}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          {/* Basic Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Key */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('flowModal.keyLabel')}
                  </label>
                  <input
                    type="text"
                    value={formData.key}
                    onChange={(e) => setFormData({
                      ...formData,
                      key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')
                    })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
                    placeholder="distributor_flow"
                    disabled={!!flow}
                    required
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('flowModal.nameRequired')}
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
                    placeholder="Flujo de Distribuidores"
                    required
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('flowModal.description')}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 resize-none"
                  rows="2"
                  placeholder={t('flowModal.descriptionPlaceholder')}
                />
              </div>

              {/* Trigger Intent */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('flowModal.triggerIntentLabel')}
                </label>
                <select
                  value={formData.triggerIntent}
                  onChange={(e) => setFormData({ ...formData, triggerIntent: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                >
                  <option value="">{t('flowModal.noTrigger')}</option>
                  {intents.filter(i => i.handlerType === 'flow').map(intent => (
                    <option key={intent.key} value={intent.key}>
                      {intent.name} ({intent.key})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {t('flowModal.triggerNote')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Timeout */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('flowModal.timeout')}
                  </label>
                  <input
                    type="number"
                    value={formData.timeout}
                    onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 30 })}
                    className="w-24 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                    min="1"
                    max="1440"
                  />
                </div>

                {/* Active */}
                <div className="flex items-center">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.active}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="relative w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    <span className="ml-3 text-sm text-gray-300">{t('flowModal.flowActive')}</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Steps Tab */}
          {activeTab === 'steps' && (
            <div className="space-y-4">
              {formData.steps.length === 0 ? (
                <div className="text-center py-8 bg-gray-700/30 rounded-lg">
                  <p className="text-gray-400 mb-4">{t('flowModal.noStepsDefined')}</p>
                  <button
                    type="button"
                    onClick={addStep}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                  >
                    {t('flowModal.addFirstStep')}
                  </button>
                </div>
              ) : (
                <>
                  {formData.steps.map((step, idx) => (
                    <div
                      key={step.stepId}
                      className="bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden"
                    >
                      {/* Step Header */}
                      <div
                        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-700/70"
                        onClick={() => setExpandedStep(expandedStep === step.stepId ? null : step.stepId)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center text-xs text-white font-medium">
                            {idx + 1}
                          </span>
                          <div>
                            <span className="text-white font-medium">
                              {step.message ? step.message.substring(0, 50) + (step.message.length > 50 ? '...' : '') : t('flowModal.stepNoMessage')}
                            </span>
                            {step.collectAs && (
                              <span className="ml-2 text-xs text-gray-400">
                                → {step.collectAs}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Move buttons */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); moveStep(step.stepId, -1); }}
                            disabled={idx === 0}
                            className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); moveStep(step.stepId, 1); }}
                            disabled={idx === formData.steps.length - 1}
                            className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); deleteStep(step.stepId); }}
                            className="p-1 text-gray-400 hover:text-red-400"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          <svg className={`w-5 h-5 text-gray-400 transition-transform ${expandedStep === step.stepId ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Step Details (Expanded) */}
                      {expandedStep === step.stepId && (
                        <div className="px-4 pb-4 space-y-4 border-t border-gray-600">
                          {/* Message */}
                          <div className="pt-4">
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                              {t('flowModal.botMessage')}
                            </label>
                            <textarea
                              value={step.message}
                              onChange={(e) => updateStep(step.stepId, { message: e.target.value })}
                              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 resize-none"
                              rows="2"
                              placeholder="¿Cuál es el nombre de tu negocio?"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            {/* Collect As */}
                            <div>
                              <label className="block text-sm font-medium text-gray-300 mb-2">
                                {t('flowModal.saveResponseAs')}
                              </label>
                              <input
                                type="text"
                                value={step.collectAs || ''}
                                onChange={(e) => updateStep(step.stepId, {
                                  collectAs: e.target.value.replace(/[^a-zA-Z0-9_]/g, '')
                                })}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
                                placeholder="businessName"
                              />
                            </div>

                            {/* Input Type */}
                            <div>
                              <label className="block text-sm font-medium text-gray-300 mb-2">
                                {t('flowModal.responseType')}
                              </label>
                              <select
                                value={step.inputType}
                                onChange={(e) => updateStep(step.stepId, { inputType: e.target.value })}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                              >
                                {INPUT_TYPES.map(type => (
                                  <option key={type.value} value={type.value}>{type.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Options (if inputType === 'options') */}
                          {step.inputType === 'options' && (
                            <div className="space-y-2">
                              <label className="block text-sm font-medium text-gray-300">
                                {t('flowModal.options')}
                              </label>
                              {(step.options || []).map((opt, optIdx) => (
                                <div key={optIdx} className="flex gap-2">
                                  <input
                                    type="text"
                                    value={opt.label}
                                    onChange={(e) => updateOption(step.stepId, optIdx, { label: e.target.value })}
                                    className="flex-1 px-3 py-1.5 bg-gray-600 border border-gray-500 rounded text-white text-sm placeholder-gray-400 focus:outline-none focus:border-primary-500"
                                    placeholder={t('flowModal.optionLabel')}
                                  />
                                  <input
                                    type="text"
                                    value={opt.value}
                                    onChange={(e) => updateOption(step.stepId, optIdx, { value: e.target.value })}
                                    className="w-32 px-3 py-1.5 bg-gray-600 border border-gray-500 rounded text-white text-sm placeholder-gray-400 focus:outline-none focus:border-primary-500"
                                    placeholder={t('flowModal.optionValue')}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => deleteOption(step.stepId, optIdx)}
                                    className="p-1.5 text-gray-400 hover:text-red-400"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => addOption(step.stepId)}
                                className="text-sm text-primary-400 hover:text-primary-300"
                              >
                                {t('flowModal.addOption')}
                              </button>
                            </div>
                          )}

                          {/* Next Step */}
                          <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                              {t('flowModal.nextStep')}
                            </label>
                            <select
                              value={step.nextStep || ''}
                              onChange={(e) => updateStep(step.stepId, { nextStep: e.target.value })}
                              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                            >
                              <option value="">{idx === formData.steps.length - 1 ? t('flowModal.completeFlow') : t('flowModal.nextInOrder')}</option>
                              {formData.steps
                                .filter(s => s.stepId !== step.stepId)
                                .map(s => (
                                  <option key={s.stepId} value={s.stepId}>
                                    {t('flowModal.stepPrefix')} {formData.steps.findIndex(x => x.stepId === s.stepId) + 1}: {s.message?.substring(0, 30)}...
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Add Step Button */}
                  <button
                    type="button"
                    onClick={addStep}
                    className="w-full py-3 border-2 border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                  >
                    {t('flowModal.addStepButton')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* On Complete Tab */}
          {activeTab === 'complete' && (
            <div className="space-y-6">
              {/* Action */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('flowModal.completeAction')}
                </label>
                <select
                  value={formData.onComplete.action}
                  onChange={(e) => setFormData({
                    ...formData,
                    onComplete: { ...formData.onComplete, action: e.target.value }
                  })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                >
                  {COMPLETE_ACTIONS.map(action => (
                    <option key={action.value} value={action.value}>{action.label}</option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t('flowModal.finalMessage')}
                </label>
                <textarea
                  value={formData.onComplete.message || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    onComplete: { ...formData.onComplete, message: e.target.value }
                  })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 resize-none"
                  rows="2"
                  placeholder={t('flowModal.completionPlaceholder')}
                />
              </div>

              {/* Handoff specific */}
              {formData.onComplete.action === 'handoff' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('flowModal.handoffReason')}
                    </label>
                    <input
                      type="text"
                      value={formData.onComplete.handoffReason || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        onComplete: { ...formData.onComplete, handoffReason: e.target.value }
                      })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
                      placeholder={t('flowModal.handoffPlaceholder')}
                    />
                  </div>

                  {/* Include Variables */}
                  {collectedVariables.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        {t('flowModal.handoffVariables')}
                      </label>
                      <div className="space-y-2">
                        {collectedVariables.map(varName => (
                          <label key={varName} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(formData.onComplete.includeVariables || []).includes(varName)}
                              onChange={(e) => {
                                const current = formData.onComplete.includeVariables || [];
                                const updated = e.target.checked
                                  ? [...current, varName]
                                  : current.filter(v => v !== varName);
                                setFormData({
                                  ...formData,
                                  onComplete: { ...formData.onComplete, includeVariables: updated }
                                });
                              }}
                              className="rounded bg-gray-600 border-gray-500 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-gray-300 font-mono text-sm">{varName}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Flow specific */}
              {formData.onComplete.action === 'flow' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('flowModal.nextFlowLabel')}
                  </label>
                  <input
                    type="text"
                    value={formData.onComplete.nextFlow || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      onComplete: { ...formData.onComplete, nextFlow: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
                    placeholder="key_del_otro_flow"
                  />
                </div>
              )}

              {/* Intent specific */}
              {formData.onComplete.action === 'intent' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('flowModal.triggerIntentSelect')}
                  </label>
                  <select
                    value={formData.onComplete.triggerIntent || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      onComplete: { ...formData.onComplete, triggerIntent: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary-500"
                  >
                    <option value="">{t('flowModal.selectIntent')}</option>
                    {intents.map(intent => (
                      <option key={intent.key} value={intent.key}>
                        {intent.name} ({intent.key})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="border-t border-gray-700 px-6 py-4 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            {flow ? t('flowModal.saveChanges') : t('flowModal.createFlow')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FlowModal;
