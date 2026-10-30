SET NOCOUNT ON;
DECLARE @task uniqueidentifier='185e121d-d888-4598-85d2-00aa47c825c5',@list uniqueidentifier=NEWID(),
 @batch uniqueidentifier=NEWID(),@second uniqueidentifier=NEWID(),@hash varchar(64)=REPLICATE('a',64);
INSERT dbo.A_TaskManager_Lists VALUES(@list,3,'fixture');
INSERT dbo.CRM_DeliveryBindings VALUES(@task,@list,'fixture');
UPDATE dbo.A_TaskManager_Tasks SET Active=0,Done=0;
-- The diagnostic native IDs must never be reused for the real source.
EXEC dbo.w_crm_delivery_import @task,@batch,@hash,N'[{"clientId":"C-first","phone":"79990000004","name":"Fixture"}]';
IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryContacts WHERE ClientId='C-first' AND Id>=1000000)
 THROW 51300,'Diagnostic ID range was reused',1;
EXEC dbo.w_crm_delivery_import @task,@batch,@hash,N'[{"clientId":"C-first","phone":"79990000004","name":"Fixture"}]';
IF (SELECT COUNT(*) FROM dbo.CRM_DeliveryContacts)<>1 THROW 51300,'Receipt replay duplicated a client',1;
-- A native collision with a different phone must abort the entire new import.
DECLARE @next int=(SELECT MAX(Id)+1 FROM dbo.CRM_DeliveryContacts);
INSERT dbo.A_TaskManager_SubTasks VALUES(@task,@next,NULL,1,0);
BEGIN TRY
 EXEC dbo.w_crm_delivery_import @task,@second,@hash,N'[{"clientId":"C-second","phone":"79990000005","name":"Fixture"}]';
 THROW 51300,'Native ID collision was accepted',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>50000 OR ERROR_MESSAGE()<>'Native contact identifier collision; no clients imported' THROW;
END CATCH;
IF EXISTS(SELECT 1 FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@second)
 OR EXISTS(SELECT 1 FROM dbo.CRM_DeliveryContacts WHERE ClientId='C-second')
 THROW 51300,'Conflicting batch was partially committed',1;
PRINT 'PASS: source ID separation, delivery replay and transactional native-history collision rejection';
