SET NOCOUNT ON;
IF EXISTS(SELECT 1 FROM dbo.crm_t1_delivery) THROW 51401,'New installation must not expose the whole source',1;
DECLARE @id int=(SELECT MIN(Id) FROM dbo.CRM_DeliveryContacts WHERE Archived=0),@ids nvarchar(max),@until datetime2=DATEADD(hour,1,SYSUTCDATETIME());
SET @ids='['+CONVERT(varchar(20),@id)+']';
EXEC dbo.CRM_T1_SetPilotScope @ids,@until;
IF (SELECT COUNT(*) FROM dbo.crm_t1_delivery)<>1 OR EXISTS(SELECT 1 FROM dbo.crm_t1_delivery WHERE Id<>@id)
 THROW 51401,'Pilot exposed a contact outside the explicit scope',1;
BEGIN TRY
 EXEC dbo.CRM_T1_SetPilotScope '[99999999]',@until;
 THROW 51401,'Missing contact was accepted',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>51400 THROW;
END CATCH;
IF (SELECT COUNT(*) FROM dbo.crm_t1_delivery)<>1 THROW 51401,'Rejected change destroyed the previous scope',1;
DECLARE @bad nvarchar(max)='['+REPLICATE('1,',1000)+'2]';
BEGIN TRY
 EXEC dbo.CRM_T1_SetPilotScope @bad,@until;
 THROW 51401,'More than 1000 contacts were accepted',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>51400 THROW;
END CATCH;
-- Exercise the complete approved batch limit using only this disposable fixture.
DECLARE @batch uniqueidentifier=NEWID(),@task uniqueidentifier='185e121d-d888-4598-85d2-00aa47c825c5';
INSERT dbo.CRM_DeliveryReceipts(BatchId,TaskId,Fingerprint,PayloadHash,Accepted)
 VALUES(@batch,@task,REPLICATE('b',64),HASHBYTES('SHA2_256','scope-fixture'),1000);
;WITH n AS (SELECT 1 n UNION ALL SELECT n+1 FROM n WHERE n<1000)
INSERT dbo.CRM_DeliveryContacts(TaskId,ClientId,Phone,Name,BatchId)
 SELECT @task,'C-scope-'+CONVERT(varchar(10),n),'799910'+RIGHT('00000'+CONVERT(varchar(5),n),5),'Scope fixture',@batch FROM n OPTION(MAXRECURSION 1000);
SELECT @ids='['+STRING_AGG(CONVERT(nvarchar(max),Id),',')+']' FROM dbo.CRM_DeliveryContacts WHERE BatchId=@batch;
EXEC dbo.CRM_T1_SetPilotScope @ids,@until;
IF (SELECT COUNT(*) FROM dbo.crm_t1_delivery)<>1000 OR EXISTS(SELECT 1 FROM dbo.crm_t1_delivery d JOIN dbo.CRM_DeliveryContacts c ON c.Id=d.Id WHERE c.BatchId<>@batch)
 THROW 51401,'Explicit 1000-contact scope was not preserved',1;
SET @bad=LEFT(@ids,LEN(@ids)-1)+','+CONVERT(varchar(20),@id)+']';
BEGIN TRY
 EXEC dbo.CRM_T1_SetPilotScope @bad,@until;
 THROW 51401,'1001 distinct contacts were accepted',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>51400 THROW;
END CATCH;
IF (SELECT COUNT(*) FROM dbo.crm_t1_delivery)<>1000 THROW 51401,'Rejected expansion destroyed the approved batch',1;
UPDATE dbo.A_TaskManager_Tasks SET Active=1;
BEGIN TRY
 EXEC dbo.CRM_T1_SetPilotScope '[]',@until;
 THROW 51401,'Active task allowed a scope change',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>51400 THROW;
END CATCH;
UPDATE dbo.A_TaskManager_Tasks SET Active=0;
UPDATE dbo.CRM_T1PilotScope SET ValidUntil=DATEADD(second,-1,SYSUTCDATETIME());
IF EXISTS(SELECT 1 FROM dbo.crm_t1_delivery) THROW 51401,'Expired scope reopened the source',1;
EXEC dbo.CRM_T1_SetPilotScope '[]',NULL;
IF EXISTS(SELECT 1 FROM dbo.CRM_T1PilotScope) THROW 51401,'Clearing scope retained clients',1;
PRINT 'PASS: explicit pilot scope, empty default, expiration and active-task rejection';
