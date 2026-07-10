require('dotenv').config();
const mongoose = require('mongoose');

async function verify() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Step 1: Ad has convoFlowRef?
  const Ad = require('../models/Ad');
  const ad = await Ad.findOne({ fbAdId: '120238481994470686' }).lean();
  console.log('=== STEP 1: Ad document ===');
  console.log('convoFlowRef:', ad?.convoFlowRef || 'MISSING');
  console.log('flowRef:', ad?.flowRef || 'none');

  // Step 2: campaignResolver returns convoFlowRef?
  const { resolveByAdId } = require('../utils/campaignResolver');
  const resolved = await resolveByAdId('120238481994470686');
  console.log('\n=== STEP 2: campaignResolver ===');
  console.log('convoFlowRef:', resolved?.convoFlowRef || 'MISSING');
  console.log('flowRef:', resolved?.flowRef || 'none');

  // Step 3: adContextMapper extracts convoFlowRef?
  const { enrichAdContext } = require('../ai/context/adContextMapper');
  const source = { ad: { id: '120238481994470686' } };
  const enriched = await enrichAdContext(source);
  console.log('\n=== STEP 3: adContextMapper ===');
  console.log('source.ad.convoFlowRef:', enriched?.ad?.convoFlowRef || 'MISSING');
  console.log('source.ad.flowRef:', enriched?.ad?.flowRef || 'none');

  // Step 4: convoFlow registry has it?
  const convoFlow = require('../ai/flows/convoFlow');
  require('../ai/flows/convo_bordeSeparadorRetail');
  require('../ai/flowManager'); // triggers registerFlow
  const flow = convoFlow.getFlow('convo_bordeSeparadorRetail');
  console.log('\n=== STEP 4: convoFlow registry ===');
  console.log('registered:', flow ? 'YES' : 'MISSING');
  console.log('has manifest:', flow?.manifest ? 'YES' : 'NO');
  console.log('has handle:', typeof flow?.handle === 'function' ? 'YES' : 'NO');

  // Step 5: detectFlow would return convo: prefix?
  console.log('\n=== STEP 5: detectFlow logic ===');
  const adConvoFlowRef = enriched?.ad?.convoFlowRef;
  if (adConvoFlowRef) {
    const convoFlowInstance = convoFlow.getFlow(adConvoFlowRef);
    if (convoFlowInstance) {
      console.log('detectFlow would return: convo:' + adConvoFlowRef);
    } else {
      console.log('detectFlow WOULD FAIL — flow not in registry');
    }
  } else {
    console.log('detectFlow WOULD FAIL — convoFlowRef not in sourceContext');
  }

  // Step 6: Can the flow actually handle a message?
  console.log('\n=== STEP 6: convo_flow handle test ===');
  try {
    const result = await flow.handle('Hola, quiero un borde separador', { userName: 'Test' }, 'test_psid', {});
    const hasText = result?.response?.text ? true : false;
    console.log('response type:', result?.response?.type || 'none');
    console.log('has text:', hasText);
    console.log('state basket:', result?.state?.basket?.length || 0, 'items');
    if (hasText) {
      console.log('response preview:', result.response.text.substring(0, 120) + '...');
    }
  } catch(e) {
    console.log('HANDLE FAILED:', e.message);
  }

  console.log('\n=== VERDICT ===');
  const step1 = !!ad?.convoFlowRef;
  const step2 = !!resolved?.convoFlowRef;
  const step3 = !!enriched?.ad?.convoFlowRef;
  const step4 = !!flow?.handle;
  const step5 = !!convoFlow.getFlow(enriched?.ad?.convoFlowRef || '');
  console.log('Step 1 (Ad DB):', step1 ? 'PASS' : 'FAIL');
  console.log('Step 2 (campaignResolver):', step2 ? 'PASS' : 'FAIL');
  console.log('Step 3 (adContextMapper):', step3 ? 'PASS' : 'FAIL');
  console.log('Step 4 (registry):', step4 ? 'PASS' : 'FAIL');
  console.log('Step 5 (detectFlow):', step5 ? 'PASS' : 'FAIL');
  console.log(step1 && step2 && step3 && step4 && step5
    ? '\nALL STEPS PASS — convo_flow is wired end-to-end'
    : '\nGAPS REMAIN — see above');

  await mongoose.disconnect();
}

verify().catch(e => console.error('FATAL:', e.message));
