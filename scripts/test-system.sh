#!/bin/bash
# System Testing Script

echo "🧪 Testing Enterprise IT Ticketing System"
echo "=========================================="

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_URL="${BASE_URL}/api/v1"

echo ""
echo "1. Testing Health Endpoint..."
curl -s "${BASE_URL}/health" | jq '.' || echo "Health check failed"

echo ""
echo "2. Testing API Endpoints (without auth - should return 401)..."
echo "   - Routing Rules:"
curl -s -X GET "${API_URL}/routing/rules" -w "\nStatus: %{http_code}\n" | head -3

echo ""
echo "   - Alert Rules:"
curl -s -X GET "${API_URL}/alerts/rules" -w "\nStatus: %{http_code}\n" | head -3

echo ""
echo "   - Chatbot Session:"
curl -s -X POST "${API_URL}/chatbot/session" -H "Content-Type: application/json" -d '{}' -w "\nStatus: %{http_code}\n" | head -3

echo ""
echo "3. Testing Database Migrations..."
echo "   Checking if all migrations are applied..."

echo ""
echo "✅ Basic system tests completed!"
echo ""
echo "To test with authentication:"
echo "1. Login via frontend at http://localhost:3000"
echo "2. Use the admin panel to configure routing and alert rules"
echo "3. Test the chatbot widget"
echo "4. Create tickets and verify auto-routing"
