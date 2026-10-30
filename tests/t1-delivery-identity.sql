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
UPDATE dbo.A_TaskManager_Tasks SET ListId=@list;
BEGIN TRY
 EXEC dbo.w_crm_delivery_complete @task,@batch;
 THROW 51300,'Unfinished client was released',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>50000 OR ERROR_MESSAGE()<>'Native queue still contains unfinished clients' THROW;
END CATCH;
INSERT dbo.A_TaskManager_SubTasks SELECT @task,Id,NULL,1,0 FROM dbo.CRM_DeliveryContacts WHERE BatchId=@batch;
INSERT dbo.A_SessionStorage VALUES(1);
BEGIN TRY
 EXEC dbo.w_crm_delivery_complete @task,@batch;
 THROW 51300,'Active session did not block completion',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>50000 OR ERROR_MESSAGE()<>'Stop the bound task and wait for sessions' THROW;
END CATCH;
DELETE dbo.A_SessionStorage;
EXEC dbo.w_crm_delivery_complete @task,@batch;
EXEC dbo.w_crm_delivery_complete @task,@batch;
EXEC dbo.w_crm_delivery_import @task,@batch,@hash,N'[{"clientId":"C-first","phone":"79990000004","name":"Fixture"}]';
IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@batch AND Completed=1)
 OR EXISTS(SELECT 1 FROM dbo.CRM_DeliveryContacts WHERE BatchId=@batch AND Archived=0)
 THROW 51300,'Receipt replay revived a completed source',1;
DECLARE @again uniqueidentifier=NEWID();
EXEC dbo.w_crm_delivery_import @task,@again,@hash,N'[{"clientId":"C-first","phone":"79990000004","name":"Fixture"}]';
IF (SELECT COUNT(*) FROM dbo.CRM_DeliveryContacts WHERE ClientId='C-first')<>2
 OR (SELECT COUNT(*) FROM dbo.CRM_DeliveryContacts WHERE ClientId='C-first' AND Archived=0)<>1
 THROW 51300,'New campaign lost archived identity',1;
PRINT 'PASS: terminal native proof, active-session guard, completion replay and re-delivery with a fresh native ID';

-- Mixed native failures reach the shared T1 cap without a terminal per-result counter.
DECLARE @exhausted uniqueidentifier=NEWID(),@nativeId int,@sameChain uniqueidentifier=NEWID();
UPDATE dbo.A_TaskManager_Lists SET Id='fd519550-95d8-45c3-9fb9-be83f3084034',Query='select id,phone,name,clientid from crm_t1_delivery' WHERE Id=@list;
UPDATE dbo.CRM_DeliveryBindings SET ListId='fd519550-95d8-45c3-9fb9-be83f3084034',SourceQuery='select id,phone,name,clientid from crm_t1_delivery' WHERE TaskId=@task;
UPDATE dbo.A_TaskManager_Tasks SET ListId='fd519550-95d8-45c3-9fb9-be83f3084034' WHERE Id=@task;
EXEC dbo.w_crm_delivery_import @task,@exhausted,@hash,N'[{"clientId":"C-exhausted","phone":"79990000006","name":"Fixture"}]';
SELECT @nativeId=Id FROM dbo.CRM_DeliveryContacts WHERE BatchId=@exhausted;
INSERT dbo.A_TaskManager_SubTasks VALUES(@task,@nativeId,NULL,0,0);
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES
 (NEWID(),@task,@sameChain,@nativeId,'79990000006',2,GETDATE()),
 (NEWID(),@task,@sameChain,@nativeId,'79990000006',2,GETDATE()),
 (NEWID(),@task,NULL,@nativeId,'79990000006',3,GETDATE()),
 (NEWID(),@task,NULL,@nativeId,'79990000006',16,GETDATE());
BEGIN TRY
 EXEC dbo.w_crm_delivery_complete @task,@exhausted;
 THROW 51300,'Duplicate chains or excluded numbers consumed the cap',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>50000 OR ERROR_MESSAGE()<>'Native queue still contains unfinished clients' THROW;
END CATCH;
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,NULL,@nativeId,'79990000006',1,GETDATE());
EXEC dbo.w_crm_delivery_complete @task,@exhausted;
IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryContacts WHERE BatchId=@exhausted AND Archived=1)
 THROW 51300,'Three mixed failures did not complete the batch',1;
IF NOT EXISTS(SELECT 1 FROM dbo.A_TaskManager_SubTasks WHERE IdInList=@nativeId AND NResult=0)
 THROW 51300,'Completion mutated native history',1;
PRINT 'PASS: three mixed native attempts release the paused batch; duplicate chains and exclusions do not';
