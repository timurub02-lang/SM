-- CRM-owned source tables. Never write native A_* tables.
IF OBJECT_ID('dbo.CRM_DeliveryContacts') IS NULL
CREATE TABLE dbo.CRM_DeliveryContacts(
 Id int IDENTITY(1000000,1) PRIMARY KEY, TaskId uniqueidentifier NOT NULL,
 ClientId nvarchar(80) NOT NULL, Phone varchar(11) NOT NULL, Name nvarchar(200) NOT NULL,
 BatchId uniqueidentifier NOT NULL, CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_CRM_DeliveryClient UNIQUE(TaskId,ClientId),
 CONSTRAINT UQ_CRM_DeliveryPhone UNIQUE(TaskId,Phone)
);
IF OBJECT_ID('dbo.CRM_DeliveryBindings') IS NULL
CREATE TABLE dbo.CRM_DeliveryBindings(TaskId uniqueidentifier PRIMARY KEY,ListId uniqueidentifier NOT NULL UNIQUE,SourceQuery nvarchar(1000) NOT NULL);
IF OBJECT_ID('dbo.CRM_DeliveryReceipts') IS NULL
CREATE TABLE dbo.CRM_DeliveryReceipts(
 BatchId uniqueidentifier PRIMARY KEY,TaskId uniqueidentifier NOT NULL,
 Fingerprint varchar(64) NOT NULL,PayloadHash binary(32) NOT NULL,Accepted int NOT NULL,
 Cancelled bit NOT NULL DEFAULT 0,CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE OR ALTER PROCEDURE dbo.w_crm_delivery_state @task uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 SELECT t.Id TaskId,t.Name TaskName,b.ListId,t.ListId TaskListId,t.Active,t.Done,
 CASE WHEN l.Id IS NOT NULL AND l.Type=3 AND l.Query=b.SourceQuery THEN 1 ELSE 0 END SourcePresent,
 (SELECT COUNT(*) FROM dbo.CRM_DeliveryContacts WHERE TaskId=@task) Contacts,
 (SELECT COUNT(*) FROM dbo.A_SessionStorage) Sessions
 FROM dbo.CRM_DeliveryBindings b JOIN oktell_settings.dbo.A_TaskManager_Tasks t ON t.Id=b.TaskId
 LEFT JOIN oktell_settings.dbo.A_TaskManager_Lists l ON l.Id=b.ListId WHERE b.TaskId=@task;
END;
GO
CREATE OR ALTER PROCEDURE dbo.w_crm_delivery_import
 @task uniqueidentifier,@batch uniqueidentifier,@fingerprint varchar(64),@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF @task IS NULL OR @batch IS NULL OR COALESCE(ISJSON(@payload),0)<>1 OR LEFT(LTRIM(@payload),1)<>'[' OR LEN(@payload)>500000 OR COALESCE(LEN(@fingerprint),0)<>64 OR @fingerprint LIKE '%[^a-f0-9]%'
  THROW 50000,'Invalid delivery payload',1;
 DECLARE @raw TABLE(ClientId nvarchar(max),Phone nvarchar(max),Name nvarchar(max));
 INSERT @raw SELECT clientId,phone,name FROM OPENJSON(@payload) WITH(clientId nvarchar(max),phone nvarchar(max),name nvarchar(max));
 DECLARE @count int=(SELECT COUNT(*) FROM @raw),@hash binary(32)=HASHBYTES('SHA2_256',@payload);
 IF @count<1 OR @count>1000 OR EXISTS(SELECT 1 FROM @raw WHERE ClientId IS NULL OR ClientId NOT LIKE 'C-%' OR LEN(ClientId)>80 OR Phone IS NULL OR LEN(Phone)<>11 OR Phone NOT LIKE '7%' OR Phone LIKE '%[^0-9]%' OR Name IS NULL OR LEN(Name)>200)
  THROW 50000,'Invalid delivery contacts',1;
 DECLARE @items TABLE(ClientId nvarchar(80) NOT NULL PRIMARY KEY,Phone varchar(11) NOT NULL UNIQUE,Name nvarchar(200) NOT NULL);
 INSERT @items SELECT ClientId,Phone,Name FROM @raw;
 BEGIN TRANSACTION;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='CRM_Delivery',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 THROW 50000,'Delivery is busy',1;
 IF EXISTS(SELECT 1 FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@batch)
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@batch AND TaskId=@task AND Fingerprint=@fingerprint AND PayloadHash=@hash AND Accepted=@count)
   THROW 50000,'Delivery identity mismatch',1;
 END
 ELSE
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryBindings b JOIN oktell_settings.dbo.A_TaskManager_Tasks t ON t.Id=b.TaskId JOIN oktell_settings.dbo.A_TaskManager_Lists l ON l.Id=b.ListId WHERE b.TaskId=@task AND t.Active=0 AND t.Done=0 AND l.Type=3 AND l.Query=b.SourceQuery)
   THROW 50000,'Paused task and verified CRM source are required',1;
  IF EXISTS(SELECT 1 FROM dbo.A_SessionStorage) THROW 50000,'Wait for active sessions before import',1;
  IF EXISTS(SELECT 1 FROM @items i JOIN dbo.CRM_DeliveryContacts c ON c.TaskId=@task AND (c.ClientId=i.ClientId OR c.Phone=i.Phone))
   THROW 50000,'Contact already belongs to task; reconcile previous delivery',1;
  INSERT dbo.CRM_DeliveryContacts(TaskId,ClientId,Phone,Name,BatchId) SELECT @task,ClientId,Phone,Name,@batch FROM @items;
  -- Native history is keyed by task + IdInList, not by list. A list swap must never
  -- make a new client inherit a diagnostic contact's attempts or terminal result.
  IF EXISTS(SELECT 1 FROM dbo.CRM_DeliveryContacts c WHERE c.BatchId=@batch AND (
   EXISTS(SELECT 1 FROM dbo.A_TaskManager_SubTasks n WHERE n.TaskId=@task AND n.IdInList=c.Id)
   OR EXISTS(SELECT 1 FROM dbo.A_TaskManager_SubTaskNumber n WHERE n.TaskId=@task AND n.IdInList=c.Id)
   OR EXISTS(SELECT 1 FROM dbo.A_TaskManager_SubTaskEfforts n WHERE n.TaskId=@task AND n.IdInList=c.Id)))
   THROW 50000,'Native contact identifier collision; no clients imported',1;
  INSERT dbo.CRM_DeliveryReceipts(BatchId,TaskId,Fingerprint,PayloadHash,Accepted) VALUES(@batch,@task,@fingerprint,@hash,@count);
 END
 COMMIT;
 SELECT BatchId,TaskId,Fingerprint,Accepted,Cancelled FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@batch;
END;
GO
CREATE OR ALTER PROCEDURE dbo.w_crm_delivery_cancel @task uniqueidentifier,@batch uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 BEGIN TRANSACTION;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='CRM_Delivery',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 THROW 50000,'Delivery is busy',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@batch AND TaskId=@task) THROW 50000,'Delivery receipt missing; reconcile before release',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@batch AND TaskId=@task AND Cancelled=1)
 BEGIN
  -- An attached task may retain a native queue. Do not pretend deleting source rows cancels those calls.
  IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryBindings b JOIN oktell_settings.dbo.A_TaskManager_Tasks t ON t.Id=b.TaskId WHERE b.TaskId=@task AND t.Active=0 AND t.ListId<>b.ListId)
   THROW 50000,'Source is attached to a task; reconcile native queue before cancellation',1;
  IF EXISTS(SELECT 1 FROM dbo.A_SessionStorage) THROW 50000,'Wait for active sessions before cancellation',1;
  DELETE FROM dbo.CRM_DeliveryContacts WHERE TaskId=@task AND BatchId=@batch;
  UPDATE dbo.CRM_DeliveryReceipts SET Cancelled=1 WHERE BatchId=@batch AND TaskId=@task;
 END
 COMMIT;
 SELECT BatchId,TaskId,Fingerprint,Accepted,Cancelled FROM dbo.CRM_DeliveryReceipts WHERE BatchId=@batch;
END;
