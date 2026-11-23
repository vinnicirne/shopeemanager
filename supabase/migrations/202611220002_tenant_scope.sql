DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manager_app') THEN
    CREATE ROLE manager_app NOLOGIN NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT manager_app TO %I', current_user);
END;
$$;

GRANT USAGE ON SCHEMA manager TO manager_app;
GRANT SELECT, UPDATE ON manager.shops TO manager_app;
GRANT SELECT, INSERT ON manager.runs, manager.audit TO manager_app;
GRANT SELECT, INSERT, UPDATE ON manager.tasks, manager.products, manager.proposals TO manager_app;
GRANT SELECT ON manager.usage TO manager_app;

DO $$
DECLARE table_name text;
DECLARE scope_column text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['shops','runs','tasks','products','audit','usage','proposals']
  LOOP
    scope_column := CASE WHEN table_name = 'shops' THEN 'id' ELSE 'shop_id' END;
    EXECUTE format('DROP POLICY IF EXISTS shop_scope ON manager.%I', table_name);
    EXECUTE format(
      'CREATE POLICY shop_scope ON manager.%I TO manager_app USING (%I = current_setting(''manager.shop_id'',true)) WITH CHECK (%I = current_setting(''manager.shop_id'',true))',
      table_name, scope_column, scope_column
    );
  END LOOP;
END;
$$;
