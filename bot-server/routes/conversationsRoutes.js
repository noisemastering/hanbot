// routes/conversationsRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Message = require('../models/Message');
const { buildClientBrief } = require('../utils/clientBrief');
const Conversation = require('../models/Conversation');
const { sendTextMessage: sendWhatsAppText, sendImageMessage: sendWhatsAppImage, sendDocumentMessage: sendWhatsAppDocument } = require('../channels/whatsapp/api');
const { cloudinary } = require('../config/cloudinary');
const multer = require('multer');

// Multer in-memory storage for attachments (we'll upload to Cloudinary manually
// to use the right resource_type per file type)
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB max (WhatsApp limit for docs)
});

// Helper: upload buffer to Cloudinary using stream
function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

/**
 * Send a message via Facebook Messenger
 */
async function sendMessengerMessage(psid, text) {
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

  const response = await axios.post(
    "https://graph.facebook.com/v18.0/me/messages",
    {
      recipient: { id: psid },
      message: { text },
    },
    {
      headers: {
        Authorization: `Bearer ${FB_PAGE_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}

/**
 * Send a Messenger attachment (image or file).
 * attachmentType: 'image' | 'file' | 'video' | 'audio'
 */
async function sendMessengerAttachment(psid, url, attachmentType = 'image') {
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

  const response = await axios.post(
    "https://graph.facebook.com/v18.0/me/messages",
    {
      recipient: { id: psid },
      message: {
        attachment: {
          type: attachmentType,
          payload: { url, is_reusable: false }
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${FB_PAGE_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}

// GET /conversations/grouped - Grouped conversations with pagination (replaces old / + N status calls)
// GET /conversations/ads - List ads that have at least one conversation (for filter dropdown)
router.get('/ads', async (req, res) => {
  try {
    const Ad = require('../models/Ad');

    // Get distinct adIds from conversations that have one
    const adIds = await Conversation.distinct('adId', { adId: { $ne: null, $exists: true } });

    if (adIds.length === 0) {
      return res.json({ ads: [] });
    }

    // Look up ad names from Ad collection
    const ads = await Ad.find({ fbAdId: { $in: adIds } })
      .select('fbAdId name status')
      .lean();

    // Build map of fbAdId → name
    const adNameMap = {};
    for (const ad of ads) {
      adNameMap[ad.fbAdId] = ad.name;
    }

    // Only return ads that have a real name (skip raw IDs without an Ad doc)
    const result = adIds
      .filter(id => adNameMap[id])
      .map(id => ({ adId: id, name: adNameMap[id] }));

    // Sort by name
    result.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ ads: result });
  } catch (error) {
    console.error('Error fetching ads for filter:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

router.get('/grouped', async (req, res) => {
  try {
    const {
      start, end, page = 1, limit = 30, excludePsids, adId,
      keyword,           // search in message content
      purchaseIntent,    // 'high' | 'medium' | 'low'
      productInterest,   // product type ID
      sharedProduct,     // 'yes' | 'no' — whether bot shared a product link
      handoff,           // 'yes' | 'no' — whether human handoff was requested
      state              // 'new' | 'active' | 'closed' | 'needs_human' | 'human_handling'
    } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    // Build the date match stage
    const dateMatch = {};
    if (start) dateMatch.$gte = new Date(start);
    if (end) dateMatch.$lt = new Date(end);

    // Build exclude list
    const excludeList = excludePsids ? excludePsids.split(',').filter(Boolean) : [];

    // Pre-filter by Conversation properties — get matching PSIDs
    const convFilter = {};
    if (adId) convFilter.adId = adId;
    if (purchaseIntent) convFilter.purchaseIntent = purchaseIntent;
    if (productInterest) convFilter.productInterest = productInterest;
    if (sharedProduct === 'yes') convFilter.lastSharedProductId = { $ne: null };
    if (sharedProduct === 'no') convFilter.lastSharedProductId = null;
    if (handoff === 'yes') convFilter.handoffRequested = true;
    if (handoff === 'no') convFilter.handoffRequested = { $ne: true };
    if (state) convFilter.state = state;

    let adFilterPsids = null;
    if (Object.keys(convFilter).length > 0) {
      adFilterPsids = await Conversation.distinct('psid', convFilter);
      if (adFilterPsids.length === 0) {
        return res.json({
          conversations: [],
          pagination: { page: 1, limit: limitNum, total: 0, pages: 0 }
        });
      }
    }

    const hasDateFilter = !!(start || end);
    const pipeline = [];

    // 1. Optional date filter on messages + ad filter + keyword filter
    const matchStage = {};
    if (hasDateFilter) matchStage.timestamp = dateMatch;
    if (excludeList.length > 0) matchStage.psid = { $nin: excludeList };
    if (adFilterPsids) {
      matchStage.psid = { ...matchStage.psid, $in: adFilterPsids };
    }
    // Multi-word keyword search: find MESSAGES that contain ALL words within
    // a single message (AND search per message). Then show the matching message.
    let keywordMatchedMessages = null; // psid → matching message text
    if (keyword && keyword.trim().length >= 2) {
      const tokens = keyword
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= 2)
        .map(w => w.replace(/[.,!?¿¡;:]/g, ''))
        .filter(Boolean);

      if (tokens.length > 0) {
        // Build regex that requires ALL tokens within one message using lookaheads
        const lookaheads = tokens
          .map(t => `(?=.*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`)
          .join('');
        const allTokensRegex = `${lookaheads}.*`;

        // Find matching messages: only USER messages by default (not bot/human replies)
        // because bot/human messages have boilerplate that pollutes results
        const matchingMessages = await Message.find({
          text: { $regex: allTokensRegex, $options: 'is' },
          senderType: 'user'  // only user-sent messages
        })
          .sort({ timestamp: -1 })
          .select('psid text timestamp')
          .limit(2000)
          .lean();

        if (matchingMessages.length === 0) {
          return res.json({
            conversations: [],
            pagination: { page: 1, limit: limitNum, total: 0, pages: 0 }
          });
        }

        // Build psid → latest matching message
        keywordMatchedMessages = {};
        for (const msg of matchingMessages) {
          if (!keywordMatchedMessages[msg.psid]) {
            keywordMatchedMessages[msg.psid] = { text: msg.text, timestamp: msg.timestamp };
          }
        }

        const keywordPsids = Object.keys(keywordMatchedMessages);

        // Combine with existing psid filter
        matchStage.psid = matchStage.psid
          ? { ...matchStage.psid, $in: keywordPsids }
          : { $in: keywordPsids };
      }
    }
    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });

    // 2. Sort by timestamp desc so $first gives latest
    pipeline.push({ $sort: { timestamp: -1 } });

    // 2b. For unfiltered queries (quick actions), pre-limit to recent messages
    // to avoid scanning the entire collection. 500 messages covers 10+ conversations easily.
    if (!hasDateFilter && excludeList.length === 0 && !adFilterPsids && !keyword) {
      pipeline.push({ $limit: 500 });
    }

    // 3. Group by psid, take latest message info
    pipeline.push({
      $group: {
        _id: '$psid',
        lastMessage: { $first: '$text' },
        lastMessageAt: { $first: '$timestamp' },
        senderType: { $first: '$senderType' },
        messageId: { $first: '$_id' }
      }
    });

    // 4. Lookup conversation metadata
    pipeline.push({
      $lookup: {
        from: 'conversations',
        localField: '_id',
        foreignField: 'psid',
        as: 'conv'
      }
    });
    pipeline.push({ $unwind: { path: '$conv', preserveNullAndEmptyArrays: true } });

    // 5. Project final shape
    pipeline.push({
      $project: {
        _id: 0,
        psid: '$_id',
        lastMessage: 1,
        lastMessageAt: 1,
        senderType: 1,
        channel: { $ifNull: ['$conv.channel', 'facebook'] },
        purchaseIntent: '$conv.purchaseIntent',
        humanActive: {
          $cond: [{ $eq: ['$conv.state', 'human_active'] }, true, false]
        },
        handoffRequested: { $ifNull: ['$conv.handoffRequested', false] },
        handoffReason: '$conv.handoffReason',
        state: '$conv.state',
        adId: '$conv.adId'
      }
    });

    // 6. Sort by latest message
    pipeline.push({ $sort: { lastMessageAt: -1 } });

    // Count total for paginated queries
    const shouldCount = hasDateFilter || !!adFilterPsids || !!keyword;
    let total = 0;
    if (shouldCount) {
      const countPipeline = [...pipeline, { $count: 'total' }];
      const countResult = await Message.aggregate(countPipeline);
      total = countResult.length > 0 ? countResult[0].total : 0;
    }

    // 7. Paginate
    pipeline.push({ $skip: (pageNum - 1) * limitNum });
    pipeline.push({ $limit: limitNum });

    let conversations = await Message.aggregate(pipeline);

    // If keyword search active, override lastMessage with the matching user message
    if (keywordMatchedMessages) {
      conversations = conversations.map(c => ({
        ...c,
        lastMessage: keywordMatchedMessages[c.psid]?.text || c.lastMessage,
        matchedSearch: true,
        senderType: 'user'  // matching message is from user
      }));
    }

    res.json({
      conversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: shouldCount ? total : conversations.length,
        pages: shouldCount ? Math.ceil(total / limitNum) : 1
      }
    });
  } catch (error) {
    console.error('Error fetching grouped conversations:', error);
    res.status(500).json({ error: 'Failed to fetch grouped conversations' });
  }
});

// GET /conversations - Get all messages with channel information (legacy)
router.get('/', async (req, res) => {
  try {
    const messages = await Message.find()
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(500)
      .lean();

    // Enrich messages with channel information from Conversation
    const enrichedMessages = await Promise.all(messages.map(async (msg) => {
      const conversation = await Conversation.findOne({ psid: msg.psid }).lean();
      return {
        ...msg,
        channel: conversation?.channel || 'facebook' // Default to facebook for backward compatibility
      };
    }));

    res.json(enrichedMessages);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /conversations/follow-ups - Get leads with future purchase intent
// IMPORTANT: This route must be before /:psid to avoid matching "follow-ups" as a psid
router.get('/follow-ups', async (req, res) => {
  try {
    const { status } = req.query; // 'pending', 'due', 'all'

    const query = {
      'futureInterest.interested': true
    };

    // Filter by status
    if (status === 'pending') {
      query['futureInterest.followedUp'] = { $ne: true };
      query['futureInterest.followUpDate'] = { $gt: new Date() };
    } else if (status === 'due') {
      query['futureInterest.followedUp'] = { $ne: true };
      query['futureInterest.followUpDate'] = { $lte: new Date() };
    }

    const followUps = await Conversation.find(query)
      .sort({ 'futureInterest.followUpDate': 1 })
      .lean();

    // Get last message for each conversation
    const enrichedFollowUps = await Promise.all(followUps.map(async (conv) => {
      const lastMessage = await Message.findOne({ psid: conv.psid })
        .sort({ timestamp: -1 })
        .lean();

      return {
        psid: conv.psid,
        channel: conv.channel || 'facebook',
        futureInterest: conv.futureInterest,
        productInterest: conv.productInterest || conv.futureInterest?.productInterest,
        requestedSize: conv.requestedSize,
        city: conv.city,
        lastMessage: lastMessage?.text,
        lastMessageAt: lastMessage?.timestamp
      };
    }));

    res.json({
      success: true,
      total: enrichedFollowUps.length,
      data: enrichedFollowUps
    });

  } catch (error) {
    console.error('Error fetching follow-ups:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch follow-ups' });
  }
});

// GET /conversations/pending-handoffs - Get after-hours handoffs since last business close
const { wasBusinessHours, getLastBusinessClose } = require('../ai/utils/businessHours');

router.get('/pending-handoffs', async (req, res) => {
  try {
    // Only look at handoffs since the last business close (yesterday 6pm or Friday 6pm)
    const cutoff = getLastBusinessClose();

    const conversations = await Conversation.find({
      handoffRequested: true,
      state: { $in: ['needs_human'] },
      $or: [
        { handoffResolved: false },
        { handoffResolved: { $exists: false } }
      ],
      handoffTimestamp: { $gte: cutoff }
    }).sort({ handoffTimestamp: 1 }).lean();

    const now = new Date();

    const data = conversations.map(conv => {
      const handoffTime = conv.handoffTimestamp ? new Date(conv.handoffTimestamp) : null;
      const isAfterHours = handoffTime ? !wasBusinessHours(handoffTime) : false;
      const waitTimeMinutes = handoffTime ? Math.round((now - handoffTime) / 60000) : null;

      return {
        psid: conv.psid,
        channel: conv.channel || 'facebook',
        handoffReason: conv.handoffReason,
        handoffTimestamp: conv.handoffTimestamp,
        productInterest: conv.productInterest,
        requestedSize: conv.requestedSize,
        city: conv.city,
        stateMx: conv.stateMx,
        currentFlow: conv.currentFlow,
        lastMessageAt: conv.lastMessageAt,
        purchaseIntent: conv.purchaseIntent,
        isAfterHours,
        waitTimeMinutes,
        brief: buildClientBrief(conv)
      };
    });

    res.json({ success: true, total: data.length, data });
  } catch (error) {
    console.error('Error fetching pending handoffs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pending handoffs' });
  }
});

// POST /conversations/:psid/do-not-follow-up - Toggle follow-up suppression
router.post('/:psid/do-not-follow-up', async (req, res) => {
  try {
    const { psid } = req.params;
    const { enabled, reason } = req.body;

    const update = enabled
      ? {
          doNotFollowUp: true,
          doNotFollowUpReason: reason || 'manual',
          doNotFollowUpAt: new Date(),
          silenceFollowUpAt: null,
          linkFollowUpAt: null
        }
      : {
          doNotFollowUp: false,
          doNotFollowUpReason: null,
          doNotFollowUpAt: null
        };

    const result = await Conversation.findOneAndUpdate({ psid }, { $set: update }, { new: true });
    if (!result) return res.status(404).json({ success: false, error: 'Conversation not found' });

    res.json({ success: true, doNotFollowUp: result.doNotFollowUp, reason: result.doNotFollowUpReason });
  } catch (error) {
    console.error('Error toggling doNotFollowUp:', error);
    res.status(500).json({ success: false, error: 'Failed to toggle' });
  }
});

// POST /conversations/:psid/resolve-handoff - Mark a handoff as resolved
router.post('/:psid/resolve-handoff', async (req, res) => {
  try {
    const { psid } = req.params;

    const result = await Conversation.findOneAndUpdate(
      { psid },
      {
        handoffResolved: true,
        handoffResolvedAt: new Date(),
        handoffRequested: false
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error resolving handoff:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve handoff' });
  }
});

// POST /conversations/:psid/resume-bot - Resume bot on a needs_human conversation
// Re-processes the customer's last message through the bot pipeline and sends the response
router.post('/:psid/resume-bot', async (req, res) => {
  try {
    const { psid } = req.params;

    const conversation = await Conversation.findOne({ psid }).lean();
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const channel = conversation.channel || 'facebook';

    // Find the customer's last message
    const lastUserMsg = await Message.findOne({ psid, senderType: 'user' })
      .sort({ timestamp: -1 })
      .lean();

    if (!lastUserMsg?.text) {
      return res.status(400).json({ success: false, error: 'No user message to re-process' });
    }

    console.log(`🔄 Resume bot for ${psid}: re-processing "${lastUserMsg.text.substring(0, 80)}..."`);

    // Clear needs_human / human_active state so generateReply doesn't bail
    const resumeUpdate = {
      state: 'active',
      lastIntent: 'bot_resumed',
      handoffResolved: true,
      handoffResolvedAt: new Date(),
      handoffRequested: false,
      pendingHandoff: false
    };

    // Resolve convoFlowRef from the ad if the conversation doesn't have one yet
    if (!conversation.convoFlowRef && conversation.adId) {
      try {
        const { resolveByAdId } = require('../utils/campaignResolver');
        const resolved = await resolveByAdId(conversation.adId);
        if (resolved?.convoFlowRef) {
          resumeUpdate.convoFlowRef = resolved.convoFlowRef;
          resumeUpdate.currentFlow = `convo:${resolved.convoFlowRef}`;
          console.log(`🎯 resume-bot: set convoFlowRef=${resolved.convoFlowRef} from ad`);
        }
      } catch (err) {
        console.error(`⚠️ resume-bot: error resolving convoFlowRef:`, err.message);
      }
    }

    await Conversation.findOneAndUpdate({ psid }, resumeUpdate);

    // Re-run the message through the AI pipeline
    const { generateReply } = require('../ai');
    const aiResponse = await generateReply(lastUserMsg.text, psid);

    if (!aiResponse?.text) {
      return res.json({ success: true, responded: false, reason: 'No AI response generated' });
    }

    // Send via appropriate channel
    if (channel === 'whatsapp') {
      const phoneNumber = psid.startsWith('wa:') ? psid.substring(3) : psid;
      await sendWhatsAppText(phoneNumber, aiResponse.text);
    } else {
      await sendMessengerMessage(psid, aiResponse.text);
    }

    // Save bot response
    await Message.create({
      psid,
      text: aiResponse.text,
      senderType: 'bot',
      timestamp: new Date()
    });

    console.log(`✅ Bot resumed for ${psid}, sent: "${aiResponse.text.substring(0, 80)}..."`);

    res.json({
      success: true,
      responded: true,
      text: aiResponse.text,
      channel
    });

  } catch (error) {
    console.error('Error resuming bot:', error);
    res.status(500).json({ success: false, error: 'Failed to resume bot' });
  }
});

// GET /conversations/:psid - Get messages for specific user with channel information
router.get('/:psid', async (req, res) => {
  try {
    const messages = await Message.find({ psid: req.params.psid })
      .sort({ timestamp: -1, createdAt: -1 })
      .lean();

    // Get channel information from Conversation
    const conversation = await Conversation.findOne({ psid: req.params.psid }).lean();
    const channel = conversation?.channel || 'facebook';

    // Enrich each message with channel information
    const enrichedMessages = messages.map(msg => ({
      ...msg,
      channel
    }));

    res.json(enrichedMessages);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// POST /conversations/reply - Send a reply to a user (Messenger or WhatsApp)
router.post('/reply', async (req, res) => {
  try {
    const { psid, text } = req.body;

    if (!psid || !text) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: psid and text'
      });
    }

    // Get channel from conversation
    const conversation = await Conversation.findOne({ psid }).lean();
    const channel = conversation?.channel || 'facebook';

    console.log(`📤 Sending reply via ${channel} to ${psid}: "${text.substring(0, 50)}..."`);

    // Send message via appropriate channel
    if (channel === 'whatsapp') {
      // WhatsApp: psid is like "wa:5214424891873", extract phone number
      const phoneNumber = psid.startsWith('wa:') ? psid.substring(3) : psid;
      await sendWhatsAppText(phoneNumber, text);
    } else {
      // Facebook Messenger
      await sendMessengerMessage(psid, text);
    }

    // Save message to database
    const message = await Message.create({
      psid,
      text,
      senderType: 'human',
      timestamp: new Date()
    });

    // Update conversation state
    await Conversation.findOneAndUpdate(
      { psid },
      {
        lastMessageAt: new Date(),
        state: 'human_active',
        handoffResolved: true,
        handoffResolvedAt: new Date()
      }
    );

    console.log(`✅ Reply sent and saved via ${channel}`);

    res.json({
      success: true,
      message,
      channel
    });

  } catch (error) {
    console.error('❌ Error sending reply:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send reply'
    });
  }
});

// POST /conversations/reply-attachment - Send a file (image or PDF) to a user
router.post('/reply-attachment', attachmentUpload.single('file'), async (req, res) => {
  try {
    const { psid, caption } = req.body;
    const file = req.file;

    if (!psid || !file) {
      return res.status(400).json({ success: false, error: 'Missing psid or file' });
    }

    // Detect type from mimetype
    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';

    if (!isImage && !isPdf) {
      return res.status(400).json({ success: false, error: 'Only images and PDFs are supported' });
    }

    // Upload to Cloudinary
    const folder = isImage ? 'hanlob/conversation-images' : 'hanlob/conversation-docs';
    const resourceType = isImage ? 'image' : 'raw';
    const publicId = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;

    const uploaded = await uploadBufferToCloudinary(file.buffer, {
      folder,
      resource_type: resourceType,
      public_id: publicId,
      use_filename: true
    });

    const fileUrl = uploaded.secure_url;
    console.log(`📎 Uploaded ${isImage ? 'image' : 'PDF'} to Cloudinary: ${fileUrl}`);

    // Get channel
    const conversation = await Conversation.findOne({ psid }).lean();
    const channel = conversation?.channel || 'facebook';

    // Send via appropriate channel
    if (channel === 'whatsapp') {
      const phoneNumber = psid.startsWith('wa:') ? psid.substring(3) : psid;
      if (isImage) {
        await sendWhatsAppImage(phoneNumber, fileUrl, caption || null);
      } else {
        await sendWhatsAppDocument(phoneNumber, fileUrl, file.originalname, caption || null);
      }
    } else {
      // Messenger
      await sendMessengerAttachment(psid, fileUrl, isImage ? 'image' : 'file');
      // Messenger doesn't support captions on attachments — send caption as separate text
      if (caption) {
        await sendMessengerMessage(psid, caption);
      }
    }

    // Save message (use a marker so the UI can show the attachment)
    const messageText = caption
      ? `[${isImage ? 'Imagen' : 'PDF'}: ${fileUrl}] ${caption}`
      : `[${isImage ? 'Imagen' : 'PDF'}: ${fileUrl}]`;

    const message = await Message.create({
      psid,
      text: messageText,
      senderType: 'human',
      timestamp: new Date()
    });

    await Conversation.findOneAndUpdate(
      { psid },
      {
        lastMessageAt: new Date(),
        state: 'human_active',
        handoffResolved: true,
        handoffResolvedAt: new Date()
      }
    );

    console.log(`✅ Attachment sent via ${channel}`);
    res.json({ success: true, message, channel, url: fileUrl });
  } catch (error) {
    console.error('❌ Error sending attachment:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to send attachment' });
  }
});

// GET /conversations/attachments/gallery - List previously uploaded files from Cloudinary
// for reuse in conversations (no re-upload needed)
router.get('/attachments/gallery', async (req, res) => {
  try {
    // Pull from the folders we use for conversation attachments + catalogs + product images
    const folders = [
      'hanlob/conversation-images',
      'hanlob/conversation-docs',
      'hanlob/catalogs',
      'hanlob/images'
    ];

    const items = [];
    for (const folder of folders) {
      // Images
      try {
        const imgResult = await cloudinary.search
          .expression(`folder:${folder} AND resource_type:image`)
          .sort_by('created_at', 'desc')
          .max_results(50)
          .execute();
        imgResult.resources.forEach(r => {
          items.push({
            type: 'image',
            url: r.secure_url,
            publicId: r.public_id,
            filename: r.public_id.split('/').pop(),
            size: r.bytes,
            createdAt: r.created_at,
            folder
          });
        });
      } catch {}

      // Raw files (PDFs)
      try {
        const rawResult = await cloudinary.search
          .expression(`folder:${folder} AND resource_type:raw`)
          .sort_by('created_at', 'desc')
          .max_results(50)
          .execute();
        rawResult.resources.forEach(r => {
          items.push({
            type: 'pdf',
            url: r.secure_url,
            publicId: r.public_id,
            filename: r.public_id.split('/').pop(),
            size: r.bytes,
            createdAt: r.created_at,
            folder
          });
        });
      } catch {}
    }

    // Sort all items by date (newest first)
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, items });
  } catch (error) {
    console.error('❌ Error fetching gallery:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /conversations/reply-from-url - Send an existing Cloudinary file (no upload)
router.post('/reply-from-url', async (req, res) => {
  try {
    const { psid, url, filename, type, caption } = req.body;

    if (!psid || !url || !type) {
      return res.status(400).json({ success: false, error: 'Missing psid, url or type' });
    }

    const isImage = type === 'image';
    const isPdf = type === 'pdf';

    if (!isImage && !isPdf) {
      return res.status(400).json({ success: false, error: 'Type must be image or pdf' });
    }

    const conversation = await Conversation.findOne({ psid }).lean();
    const channel = conversation?.channel || 'facebook';

    if (channel === 'whatsapp') {
      const phoneNumber = psid.startsWith('wa:') ? psid.substring(3) : psid;
      if (isImage) {
        await sendWhatsAppImage(phoneNumber, url, caption || null);
      } else {
        await sendWhatsAppDocument(phoneNumber, url, filename || 'documento.pdf', caption || null);
      }
    } else {
      await sendMessengerAttachment(psid, url, isImage ? 'image' : 'file');
      if (caption) {
        await sendMessengerMessage(psid, caption);
      }
    }

    const messageText = caption
      ? `[${isImage ? 'Imagen' : 'PDF'}: ${url}] ${caption}`
      : `[${isImage ? 'Imagen' : 'PDF'}: ${url}]`;

    const message = await Message.create({
      psid,
      text: messageText,
      senderType: 'human',
      timestamp: new Date()
    });

    await Conversation.findOneAndUpdate(
      { psid },
      {
        lastMessageAt: new Date(),
        state: 'human_active',
        handoffResolved: true,
        handoffResolvedAt: new Date()
      }
    );

    console.log(`✅ Reused attachment sent via ${channel}`);
    res.json({ success: true, message, channel, url });
  } catch (error) {
    console.error('❌ Error sending from URL:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to send' });
  }
});

// POST /conversations/:psid/mark-followed-up - Mark a lead as followed up
router.post('/:psid/mark-followed-up', async (req, res) => {
  try {
    const { psid } = req.params;

    const result = await Conversation.findOneAndUpdate(
      { psid },
      {
        'futureInterest.followedUp': true,
        'futureInterest.followedUpAt': new Date()
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({ success: true, data: result.futureInterest });

  } catch (error) {
    console.error('Error marking follow-up:', error);
    res.status(500).json({ success: false, error: 'Failed to mark follow-up' });
  }
});

// ============================================================
// PURCHASE INTENT ENDPOINTS
// ============================================================

const { getScoreExplanation } = require('../ai/utils/purchaseIntentScorer');

// GET /conversations/purchase-intent/stats - Summary stats by intent level
router.get('/purchase-intent/stats', async (req, res) => {
  try {
    const stats = await Conversation.aggregate([
      {
        $match: {
          purchaseIntent: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$purchaseIntent',
          count: { $sum: 1 },
          conversations: {
            $push: {
              psid: '$psid',
              userName: '$userName',
              updatedAt: '$updatedAt'
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          intent: '$_id',
          count: 1,
          recentConversations: { $slice: ['$conversations', 5] }
        }
      }
    ]);

    // Format as object for easier consumption
    const formatted = {
      high: { count: 0, recentConversations: [] },
      medium: { count: 0, recentConversations: [] },
      low: { count: 0, recentConversations: [] }
    };

    stats.forEach(s => {
      if (formatted[s.intent]) {
        formatted[s.intent] = {
          count: s.count,
          recentConversations: s.recentConversations
        };
      }
    });

    // Get total conversations for context
    const total = await Conversation.countDocuments({ purchaseIntent: { $exists: true } });

    res.json({
      success: true,
      data: {
        ...formatted,
        total,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting purchase intent stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// GET /conversations/purchase-intent/leads - Get conversations by intent level
router.get('/purchase-intent/leads', async (req, res) => {
  try {
    const { intent = 'high', limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const conversations = await Conversation.find({
      purchaseIntent: intent
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('psid userName channel state purchaseIntent intentSignals productInterest updatedAt createdAt')
      .lean();

    // Enrich with score explanation
    const enriched = conversations.map(c => ({
      ...c,
      scoreExplanation: c.intentSignals ? getScoreExplanation(c.intentSignals) : []
    }));

    const total = await Conversation.countDocuments({ purchaseIntent: intent });

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error getting purchase intent leads:', error);
    res.status(500).json({ success: false, error: 'Failed to get leads' });
  }
});

// GET /conversations/purchase-intent/:psid - Get purchase intent for specific conversation
router.get('/purchase-intent/:psid', async (req, res) => {
  try {
    const { psid } = req.params;

    const conversation = await Conversation.findOne({ psid })
      .select('psid userName purchaseIntent intentSignals isWholesaleInquiry productInterest state')
      .lean();

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({
      success: true,
      data: {
        ...conversation,
        scoreExplanation: conversation.intentSignals ? getScoreExplanation(conversation.intentSignals) : [],
        intentEmoji: conversation.purchaseIntent === 'high' ? '🟢' :
                     conversation.purchaseIntent === 'low' ? '🔴' : '🟡'
      }
    });
  } catch (error) {
    console.error('Error getting purchase intent:', error);
    res.status(500).json({ success: false, error: 'Failed to get purchase intent' });
  }
});

// POST /conversations/:psid/register-sale - Register a manual sale for ROI tracking
router.post('/:psid/register-sale', async (req, res) => {
  try {
    const { psid } = req.params;
    const { productName, quantity, totalAmount, notes, orderId, crmName, crmPhone, crmEmail, zipCode } = req.body;

    if (!productName || !totalAmount) {
      return res.status(400).json({
        success: false,
        error: 'Product name and total amount are required'
      });
    }

    // Get conversation context
    const conversation = await Conversation.findOne({ psid }).lean();

    // Save customer CRM info if provided
    const crmUpdate = {};
    if (crmName?.trim()) crmUpdate.crmName = crmName.trim();
    if (crmPhone?.trim()) crmUpdate.crmPhone = crmPhone.trim();
    if (crmEmail?.trim()) crmUpdate.crmEmail = crmEmail.trim();
    if (zipCode?.trim()) crmUpdate.zipCode = zipCode.trim();
    if (Object.keys(crmUpdate).length > 0) {
      await Conversation.updateOne({ psid }, { $set: crmUpdate });
    }

    // Generate synthetic clickId
    const { randomUUID } = require('crypto');
    const clickId = `manual-${randomUUID().slice(0, 8)}`;

    const ClickLog = require('../models/ClickLog');

    const clickLog = new ClickLog({
      clickId,
      psid,
      originalUrl: 'manual-sale',
      productName,
      campaignId: conversation?.adId ? conversation.campaignId : null,
      adSetId: conversation?.adSetId || null,
      adId: conversation?.adId || null,
      userName: crmName?.trim() || conversation?.crmName || conversation?.userName || null,
      city: conversation?.city || null,
      stateMx: conversation?.stateMx || null,
      clicked: true,
      clickedAt: new Date(),
      converted: true,
      convertedAt: new Date(),
      correlationMethod: 'manual',
      correlationConfidence: 'high',
      conversionData: {
        totalAmount: parseFloat(totalAmount),
        paidAmount: parseFloat(totalAmount),
        itemTitle: productName,
        itemQuantity: parseInt(quantity) || 1,
        orderId: orderId || clickId,
        orderDate: new Date(),
        manualNotes: notes || null
      }
    });

    await clickLog.save();

    console.log(`💰 Manual sale registered: $${totalAmount} - ${productName} for ${psid}`);

    res.json({
      success: true,
      clickLog: {
        clickId,
        productName,
        totalAmount: parseFloat(totalAmount),
        psid,
        userName: conversation?.userName
      }
    });
  } catch (error) {
    console.error('Error registering manual sale:', error);
    res.status(500).json({ success: false, error: 'Failed to register sale' });
  }
});

// GET /conversations/:psid/commerce-status - did this user click a shared link, and did they buy?
// Reads ClickLog (clicked/converted are kept fresh by ML webhooks + analytics jobs).
// Pass ?sync=true to refresh recent ML orders and re-run correlation on demand.
router.get('/:psid/commerce-status', async (req, res) => {
  try {
    const { psid } = req.params;
    const ClickLog = require('../models/ClickLog');
    let synced = false;

    if (req.query.sync === 'true') {
      try {
        const MercadoLibreAuth = require('../models/MercadoLibreAuth');
        const { getOrders } = require('../utils/mercadoLibreOrders');
        const { correlateOrders } = require('../utils/conversionCorrelation');
        const auth = await MercadoLibreAuth.findOne({ active: true }).lean();
        if (auth?.sellerId) {
          const dateFrom = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
          const result = await getOrders(auth.sellerId, { dateFrom, limit: 50 });
          const orders = (result?.orders || result || []).filter(
            (o) => o.status === 'paid' || o.status === 'delivered' || o.paidAmount > 0
          );
          if (orders.length) await correlateOrders(orders, auth.sellerId);
          synced = true;
        }
      } catch (syncErr) {
        console.error('commerce-status sync failed:', syncErr.message);
      }
    }

    const clicks = await ClickLog.find({ psid }).sort({ createdAt: -1 }).lean();
    const clickedLog = clicks.find((c) => c.clicked);
    const convertedLog = clicks.find((c) => c.converted && c.correlatedOrderId);

    res.json({
      success: true,
      synced,
      hasLink: clicks.length > 0,
      clicked: !!clickedLog,
      clickedAt: clickedLog?.clickedAt || null,
      link: (clickedLog || clicks[0])?.originalUrl || null,
      productName: (clickedLog || clicks[0])?.productName || null,
      purchased: !!convertedLog,
      conversion: convertedLog
        ? {
            orderId: convertedLog.correlatedOrderId,
            confidence: convertedLog.correlationConfidence,
            method: convertedLog.correlationMethod,
            totalAmount: convertedLog.conversionData?.totalAmount || null,
            currency: convertedLog.conversionData?.currency || null,
            orderDate: convertedLog.conversionData?.orderDate || convertedLog.convertedAt || null,
            itemTitle: convertedLog.conversionData?.itemTitle || null,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching commerce status:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch commerce status' });
  }
});

module.exports = router;
