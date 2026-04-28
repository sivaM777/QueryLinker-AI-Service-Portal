-- Align legacy demo support teams under the enterprise team hierarchy so the
-- Teams page reflects a single coherent L1/L2/L3 structure.

UPDATE teams child
SET parent_team_id = parent.id
FROM teams parent
WHERE child.name = 'L1 Support'
  AND parent.name = 'L1 - Global Service Desk'
  AND child.parent_team_id IS DISTINCT FROM parent.id;

UPDATE teams child
SET parent_team_id = parent.id
FROM teams parent
WHERE child.name = 'L2 Technical Support'
  AND parent.name = 'L2 - Infrastructure Support'
  AND child.parent_team_id IS DISTINCT FROM parent.id;

UPDATE teams child
SET parent_team_id = parent.id
FROM teams parent
WHERE child.name = 'L3 Expert Team'
  AND parent.name = 'L3 - Engineering & Strategy'
  AND child.parent_team_id IS DISTINCT FROM parent.id;
