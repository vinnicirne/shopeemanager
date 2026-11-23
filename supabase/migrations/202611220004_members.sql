GRANT SELECT, INSERT, UPDATE, DELETE ON manager.members TO manager_app;
DROP POLICY IF EXISTS shop_scope ON manager.members;
CREATE POLICY shop_scope ON manager.members TO manager_app
  USING (shop_id = current_setting('manager.shop_id',true))
  WITH CHECK (shop_id = current_setting('manager.shop_id',true));
