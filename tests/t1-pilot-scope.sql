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
DECLARE @bad nvarchar(max)='['+REPLICATE('1,',50)+'2]';
BEGIN TRY
 EXEC dbo.CRM_T1_SetPilotScope @bad,@until;
 THROW 51401,'More than 50 contacts were accepted',1;
END TRY BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 IF ERROR_NUMBER()<>51400 THROW;
END CATCH;
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
