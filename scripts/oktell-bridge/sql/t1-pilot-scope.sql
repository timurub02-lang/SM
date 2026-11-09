-- Install while T1 is stopped. Empty/expired scope blocks real-source selection.
IF OBJECT_ID('dbo.CRM_T1PilotScope') IS NULL
 CREATE TABLE dbo.CRM_T1PilotScope(ContactId int PRIMARY KEY,ValidUntil datetime2 NOT NULL);
GO
CREATE OR ALTER PROCEDURE dbo.CRM_T1_SetPilotScope @ids nvarchar(max),@until datetime2
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF COALESCE(ISJSON(@ids),0)<>1 OR LEFT(LTRIM(@ids),1)<>'[' OR LEN(@ids)>2000
  THROW 51400,'Expected an explicit list of at most 50 native contact IDs',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@ids))>50 OR EXISTS(SELECT 1 FROM OPENJSON(@ids) WHERE type<>2 OR TRY_CONVERT(int,value) IS NULL OR value LIKE '%.%')
  THROW 51400,'Invalid pilot contact IDs',1;
 IF EXISTS(SELECT value FROM OPENJSON(@ids) GROUP BY value HAVING COUNT(*)>1)
  THROW 51400,'Duplicate pilot contact IDs',1;
 DECLARE @selected TABLE(Id int PRIMARY KEY);
 INSERT @selected SELECT CONVERT(int,value) FROM OPENJSON(@ids);
 IF EXISTS(SELECT 1 FROM @selected) AND (@until IS NULL OR @until<=SYSUTCDATETIME() OR @until>DATEADD(hour,4,SYSUTCDATETIME()))
  THROW 51400,'Pilot scope must expire within four hours',1;
 BEGIN TRANSACTION;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='CRM_Delivery',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 THROW 51400,'Delivery is busy',1;
 IF NOT EXISTS(SELECT 1 FROM oktell_settings.dbo.A_TaskManager_Tasks WHERE Id='185e121d-d888-4598-85d2-00aa47c825c5' AND Active=0 AND Done=0 AND ListId='fd519550-95d8-45c3-9fb9-be83f3084034')
  OR EXISTS(SELECT 1 FROM dbo.A_SessionStorage) THROW 51400,'Pause T1 and wait for sessions before changing scope',1;
 IF EXISTS(SELECT 1 FROM @selected s WHERE NOT EXISTS(
  SELECT 1 FROM dbo.CRM_DeliveryContacts c JOIN dbo.CRM_DeliveryReceipts r ON r.BatchId=c.BatchId AND r.TaskId=c.TaskId
  WHERE c.Id=s.Id AND c.TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND c.Archived=0 AND r.Cancelled=0 AND r.Completed=0))
  THROW 51400,'Pilot contains a missing or completed contact',1;
 DELETE FROM dbo.CRM_T1PilotScope;
 INSERT dbo.CRM_T1PilotScope SELECT Id,@until FROM @selected;
 COMMIT;
 SELECT COUNT(*) Contacts,MAX(ValidUntil) ValidUntil FROM dbo.CRM_T1PilotScope;
END;
GO
CREATE OR ALTER VIEW dbo.crm_t1_delivery AS
 SELECT c.Id,c.Phone,c.Name,c.ClientId FROM dbo.CRM_DeliveryContacts c
 JOIN dbo.CRM_DeliveryReceipts r ON r.TaskId=c.TaskId AND r.BatchId=c.BatchId
 JOIN dbo.CRM_T1PilotScope p ON p.ContactId=c.Id AND p.ValidUntil>SYSUTCDATETIME()
 WHERE c.TaskId='185e121d-d888-4598-85d2-00aa47c825c5'
 AND c.Archived=0 AND r.Cancelled=0 AND r.Completed=0;
GO
CREATE OR ALTER PROCEDURE dbo.w_crm_delivery_state @task uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 SELECT t.Id TaskId,t.Name TaskName,b.ListId,t.ListId TaskListId,t.Active,t.Done,
 CASE WHEN l.Id IS NOT NULL AND l.Type=3 AND l.Query=b.SourceQuery THEN 1 ELSE 0 END SourcePresent,
 (SELECT COUNT(*) FROM dbo.CRM_DeliveryContacts WHERE TaskId=@task AND Archived=0) Contacts,
 (SELECT COUNT(*) FROM dbo.A_SessionStorage) Sessions,
 (SELECT COUNT(*) FROM dbo.crm_t1_delivery) PilotContacts,
 CONVERT(varchar(30),(SELECT MAX(ValidUntil) FROM dbo.CRM_T1PilotScope),126) PilotUntil
 FROM dbo.CRM_DeliveryBindings b JOIN oktell_settings.dbo.A_TaskManager_Tasks t ON t.Id=b.TaskId
 LEFT JOIN oktell_settings.dbo.A_TaskManager_Lists l ON l.Id=b.ListId WHERE b.TaskId=@task;
END;
