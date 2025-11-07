#!/bin/bash

# Facebook Handover Protocol Setup Script
# App ID: 1555790368916637

# You need:
# 1. PAGE_ACCESS_TOKEN from your .env file
# 2. Your Facebook Page ID

echo "🔧 Facebook Handover Protocol Setup"
echo ""

# Load PAGE_ACCESS_TOKEN from .env
source .env

if [ -z "$FB_PAGE_ACCESS_TOKEN" ]; then
  echo "❌ Error: FB_PAGE_ACCESS_TOKEN not found in .env"
  echo "Please add: FB_PAGE_ACCESS_TOKEN=your_token_here"
  exit 1
fi

echo "✅ Found PAGE_ACCESS_TOKEN"
echo ""

# Get the current primary receiver (your bot app)
echo "📋 Step 1: Getting current thread owner settings..."
echo ""

curl -X GET "https://graph.facebook.com/v21.0/me/thread_owner?access_token=$FB_PAGE_ACCESS_TOKEN"

echo ""
echo ""

# Set your app as primary receiver
echo "🤖 Step 2: Setting your app as PRIMARY RECEIVER..."
echo ""

APP_ID="1555790368916637"

curl -X POST "https://graph.facebook.com/v21.0/me/thread_settings?access_token=$FB_PAGE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "setting_type": "call_to_actions",
    "thread_state": "existing_thread",
    "call_to_actions": [
      {
        "type": "postback"
      }
    ]
  }'

echo ""
echo ""

# Subscribe to handover webhooks
echo "🔔 Step 3: Subscribing to messaging_handovers webhook..."
echo ""

curl -X POST "https://graph.facebook.com/v21.0/$APP_ID/subscriptions?access_token=$FB_PAGE_ACCESS_TOKEN" \
  -d "object=page" \
  -d "callback_url=https://your-server-url.com/webhook" \
  -d "fields=messaging_handovers" \
  -d "verify_token=$FB_VERIFY_TOKEN"

echo ""
echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Go to: https://developers.facebook.com/apps/1555790368916637/messenger/messenger_api_settings/"
echo "2. Scroll down to find 'Handover Protocol' or 'Secondary Receivers'"
echo "3. Add 'Page Inbox' (App ID: 263902037430900) as secondary receiver"
echo ""
echo "If you still don't see the option, the Handover Protocol might not be available for your app."
echo "In that case, use the REST API I built: POST /api/conversation/:psid/takeover"
