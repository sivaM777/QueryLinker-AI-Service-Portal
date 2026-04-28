SELECT
  n.id,
  n.user_id,
  u.email,
  u.role,
  n.type,
  n.title,
  n.body,
  n.ticket_id,
  n.created_at
FROM notifications n
JOIN users u ON u.id = n.user_id
WHERE n.title ILIKE '%Approval required%'
   OR n.body ILIKE '%Reset VPN%'
ORDER BY n.created_at DESC
LIMIT 50;
