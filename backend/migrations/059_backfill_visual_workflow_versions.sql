INSERT INTO workflow_graph_versions (
  workflow_id,
  version_number,
  snapshot,
  change_summary,
  created_by
)
SELECT
  wf.id,
  1,
  jsonb_build_object(
    'id', wf.id,
    'name', wf.name,
    'description', wf.description,
    'enabled', wf.enabled,
    'categoryFilter', COALESCE(to_jsonb(wf.category_filter), '[]'::jsonb),
    'triggerType', wf.trigger_type,
    'triggerConfig', COALESCE(wf.trigger_config, '{}'::jsonb),
    'priority', wf.priority,
    'nodes', COALESCE(nodes.nodes, '[]'::jsonb),
    'edges', COALESCE(edges.edges, '[]'::jsonb),
    'createdBy', wf.created_by,
    'updatedBy', wf.updated_by,
    'createdAt', wf.created_at,
    'updatedAt', wf.updated_at
  ),
  'Initial backfill',
  COALESCE(wf.updated_by, wf.created_by)
FROM workflow_graphs wf
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', wn.node_id,
      'type', wn.type,
      'position', jsonb_build_object('x', wn.position_x, 'y', wn.position_y),
      'data', COALESCE(wn.data, '{}'::jsonb)
    )
    ORDER BY wn.node_id
  ) AS nodes
  FROM workflow_nodes wn
  WHERE wn.workflow_id = wf.id
) nodes ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', we.edge_id,
      'source', we.source_node_id,
      'target', we.target_node_id,
      'condition', we.condition,
      'animated', COALESCE(we.animated, false)
    )
    ORDER BY we.edge_id
  ) AS edges
  FROM workflow_edges we
  WHERE we.workflow_id = wf.id
) edges ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_graph_versions existing
  WHERE existing.workflow_id = wf.id
);
