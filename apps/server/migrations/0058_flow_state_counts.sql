DROP TABLE flow_state_usage;
UPDATE flow_state_values SET size = length(CAST(value_json AS BLOB));
