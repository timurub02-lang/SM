-- Staged installation: requires the installed T1 time/priority selector.
-- Keep T1 stopped until bridge sync, procedure allowlist and resource mode 11 are verified.
CREATE TABLE dbo.CRM_T1CallbackResults(
 CommandId uniqueidentifier NOT NULL PRIMARY KEY, ChainId uniqueidentifier NOT NULL UNIQUE,
 ListId uniqueidentifier NOT NULL, ContactId int NOT NULL, Phone varchar(32) NOT NULL,
 OperatorId uniqueidentifier NOT NULL, DueUtc datetime2 NULL, EffortAt datetime2 NOT NULL,
 Released bit NOT NULL DEFAULT 0);
CREATE INDEX IX_CRM_T1CallbackResults_Contact ON dbo.CRM_T1CallbackResults(ListId,ContactId,Phone,EffortAt DESC);
GO
CREATE PROCEDURE dbo.w_crm_t1_callback_sync
 @command uniqueidentifier,@chain uniqueidentifier,@task uniqueidentifier,@list uniqueidentifier,
 @operator uniqueidentifier,@phone varchar(32),@due nvarchar(40)=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF @task IS NULL OR @task<>'185e121d-d888-4598-85d2-00aa47c825c5' THROW 51010,'Wrong callback task',1;
 DECLARE @dueUtc datetime2=CONVERT(datetime2,SWITCHOFFSET(TRY_CONVERT(datetimeoffset,@due),'+00:00'));
 IF @due IS NOT NULL AND @dueUtc IS NULL THROW 51011,'Invalid callback time',1;
 IF EXISTS(SELECT 1 FROM dbo.CRM_T1CallbackResults WHERE CommandId=@command) BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.CRM_T1CallbackResults WHERE CommandId=@command AND ChainId=@chain AND ListId=@list AND Phone=@phone
   AND OperatorId=@operator AND (DueUtc=@dueUtc OR DueUtc IS NULL AND @dueUtc IS NULL)) THROW 51012,'Callback command conflict',1;
  SELECT CONVERT(varchar(36),@command) CommandId; RETURN;
 END;
 DECLARE @contact int,@effort datetime2;
 IF NOT EXISTS(SELECT 1 FROM oktell_settings.dbo.A_TaskManager_Tasks WHERE Id=@task AND ListId=@list) THROW 51015,'Task list changed; reconcile pending results',1;
 -- Wait for native result persistence; a timeout is retried with the same immutable command.
 IF (SELECT COUNT(DISTINCT IdInList) FROM dbo.A_TaskManager_SubTaskEfforts
  WHERE TaskId=@task AND ConnectionChainId=@chain AND Number=@phone AND (@dueUtc IS NULL OR EResult=8))<>1
  THROW 51013,'Native callback result not correlated yet',1;
 SELECT TOP(1) @contact=IdInList,@effort=EDateTime FROM dbo.A_TaskManager_SubTaskEfforts
  WHERE TaskId=@task AND ConnectionChainId=@chain AND Number=@phone AND (@dueUtc IS NULL OR EResult=8)
  ORDER BY EDateTime DESC;
 IF NOT EXISTS(SELECT 1 FROM dbo.CRM_T1TimeCandidates(@list) WHERE Id=@contact AND Phone=@phone)
  OR NOT EXISTS(SELECT 1 FROM dbo.A_Users WHERE Id=@operator) THROW 51014,'Callback identity mismatch',1;
 INSERT dbo.CRM_T1CallbackResults(CommandId,ChainId,ListId,ContactId,Phone,OperatorId,DueUtc,EffortAt)
  VALUES(@command,@chain,@list,@contact,@phone,@operator,@dueUtc,@effort);
 SELECT CONVERT(varchar(36),@command) CommandId;
END;
GO
CREATE FUNCTION dbo.CRM_T1OwnerReady(@owner uniqueidentifier)
RETURNS TABLE AS RETURN
 SELECT CONVERT(bit,CASE WHEN EXISTS(
  SELECT 1 FROM dbo.A_Users u JOIN dbo.A_UserParams p ON p.IdUser=u.Id
  CROSS APPLY(SELECT TOP(1) State FROM dbo.A_UserStateHistory h WHERE h.UserId=u.Id ORDER BY h.Enumerator DESC) h
  WHERE u.Id=@owner AND u.Enabled=1 AND u.IsDeleted=0 AND p.IsOperator=1 AND h.State=1
   AND EXISTS(SELECT 1 FROM dbo.A_TaskManager_Operators o WHERE o.TaskId='185e121d-d888-4598-85d2-00aa47c825c5'
    AND o.IsGroup=0 AND o.OperatorId=u.Id)) THEN 1 ELSE 0 END) Ready;
GO
CREATE FUNCTION dbo.CRM_T1Affinity(@now datetime2,@due datetime2,@released bit,@ready bit,@pending bit)
RETURNS TABLE AS RETURN
 SELECT CONVERT(bit,CASE WHEN @pending=1 OR @due>@now THEN 0
  WHEN @due IS NULL OR @released=1 OR @ready=1 OR @now>=DATEADD(minute,30,@due) THEN 1 ELSE 0 END) Eligible,
 CONVERT(bit,CASE WHEN @due IS NOT NULL AND @released=0 AND NOT(@ready=0 AND @now>=DATEADD(minute,30,@due)) THEN 1 ELSE 0 END) OwnerOnly,
 CONVERT(bit,CASE WHEN @due IS NOT NULL AND @released=0 AND @ready=0 AND @now>=DATEADD(minute,30,@due) THEN 1 ELSE 0 END) ReleaseDue;
GO
CREATE FUNCTION dbo.CRM_T1CallbackState(@list uniqueidentifier,@id int,@phone varchar(32),@now datetime2)
RETURNS TABLE AS RETURN
 SELECT r.CommandId,r.OperatorId,r.DueUtc,a.Eligible,a.OwnerOnly,a.ReleaseDue
 FROM (SELECT 1 seed) seed
 OUTER APPLY(SELECT TOP(1) * FROM dbo.CRM_T1CallbackResults
  WHERE ListId=@list AND ContactId=@id AND Phone=@phone
   AND EXISTS(SELECT 1 FROM dbo.A_TaskManager_SubTaskEfforts e WHERE e.TaskId='185e121d-d888-4598-85d2-00aa47c825c5'
    AND e.ConnectionChainId=CRM_T1CallbackResults.ChainId AND e.IdInList=@id AND e.Number=@phone)
  ORDER BY EffortAt DESC,CommandId) r
 OUTER APPLY(SELECT TOP(1) ConnectionChainId,EDateTime FROM dbo.A_TaskManager_SubTaskEfforts
  WHERE TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND IdInList=@id AND Number=@phone AND EResult=8
  ORDER BY EDateTime DESC,Id) n
 CROSS APPLY dbo.CRM_T1OwnerReady(r.OperatorId) ready
 CROSS APPLY dbo.CRM_T1Affinity(@now,r.DueUtc,COALESCE(r.Released,0),ready.Ready,
  CASE WHEN n.EDateTime IS NOT NULL AND (n.ConnectionChainId IS NULL OR r.CommandId IS NULL OR n.EDateTime>r.EffortAt
   OR n.EDateTime=r.EffortAt AND n.ConnectionChainId<>r.ChainId) THEN 1 ELSE 0 END) a;
GO
-- This is Oktell's documented extension point. Preserve the default for other tasks.
ALTER PROCEDURE dbo.A_TaskManager_OperatorsAll_Get_Custom
 @idtask uniqueidentifier='00000000-0000-0000-0000-000000000000',
 @idlist uniqueidentifier='00000000-0000-0000-0000-000000000000',@idabonent int=0,
 @idline uniqueidentifier='00000000-0000-0000-0000-000000000000',@dtnow datetime=NULL
AS
BEGIN
 SET NOCOUNT ON;
 IF @idtask<>'185e121d-d888-4598-85d2-00aa47c825c5' BEGIN
  SELECT u.Id FROM dbo.A_Users u JOIN dbo.A_UserParams p ON p.IdUser=u.Id WHERE p.IsOperator=1; RETURN;
 END;
 DECLARE @now datetime2=SYSUTCDATETIME(),@phone varchar(32),@owner uniqueidentifier,@only bit,@eligible bit,@command uniqueidentifier,@release bit;
 IF NOT EXISTS(SELECT 1 FROM oktell_settings.dbo.A_TaskManager_Tasks WHERE Id=@idtask AND ListId=@idlist)
  OR (SELECT COUNT(*) FROM dbo.CRM_T1TimeCandidates(@idlist) WHERE Id=@idabonent)<>1 BEGIN
  SELECT Id FROM dbo.A_Users WHERE 1=0; RETURN;
 END;
 SELECT @phone=Phone FROM dbo.CRM_T1TimeCandidates(@idlist) WHERE Id=@idabonent;
 SELECT @owner=OperatorId,@only=OwnerOnly,@eligible=Eligible,@command=CommandId,@release=ReleaseDue
  FROM dbo.CRM_T1CallbackState(@idlist,@idabonent,@phone,@now);
 IF @release=1 UPDATE dbo.CRM_T1CallbackResults SET Released=1 WHERE CommandId=@command;
 SELECT u.Id FROM dbo.A_Users u JOIN dbo.A_UserParams p ON p.IdUser=u.Id
 CROSS APPLY dbo.CRM_CallTimeDecision(@idtask,@phone,@now) t
 WHERE @eligible=1 AND t.Allowed=1 AND p.IsOperator=1 AND u.Enabled=1 AND u.IsDeleted=0 AND (@only=0 OR u.Id=@owner)
 ORDER BY CASE WHEN u.Id=@owner THEN 0 ELSE 1 END,u.Id;
END;
GO
ALTER PROCEDURE dbo.CRM_T1_Select
 @list uniqueidentifier,@id nvarchar(40) OUTPUT,@phone nvarchar(32) OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 SET @id=''; SET @phone='';
 IF NOT EXISTS(SELECT 1 FROM oktell_settings.dbo.A_TaskManager_Tasks
   WHERE Id='185e121d-d888-4598-85d2-00aa47c825c5' AND ListId=@list) RETURN;
 DECLARE @now datetime2=SYSUTCDATETIME(),@local datetime2=SYSDATETIME(),
   @last int=0,@next int,@lock int;
 BEGIN TRANSACTION;
 EXEC @lock=sys.sp_getapplock @Resource='CRM_T1TimeCursor',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=1000;
 IF @lock<0 THROW 51001,'Time selection lock unavailable',1;
 SELECT @last=LastId FROM dbo.CRM_T1TimeCursor WHERE ListId=@list;
 -- Release is permanent for this callback, even if the former operator returns later.
 UPDATE r SET Released=1 FROM dbo.CRM_T1CallbackResults r
 CROSS APPLY dbo.CRM_T1CallbackState(r.ListId,r.ContactId,r.Phone,@now) a
 WHERE r.ListId=@list AND a.CommandId=r.CommandId AND a.ReleaseDue=1;
 SELECT TOP(1) @next=c.Id,@phone=c.Phone
 FROM dbo.CRM_T1TimeCandidates(@list) c
 LEFT JOIN dbo.A_TaskManager_SubTasks s ON s.TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND s.IdInList=c.Id
 LEFT JOIN dbo.A_TaskManager_SubTaskNumber n ON n.TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND n.IdInList=c.Id AND n.Number=c.Phone
 LEFT JOIN dbo.CRM_T1SelectionOffers o ON o.ListId=@list AND o.Id=c.Id
 CROSS APPLY dbo.CRM_T1CandidateTiming(@now,@local,c.Phone,s.NextEffortTime,n.NextEffortTime,s.NResult,s.IsDeleted,n.NResult) timing
 CROSS APPLY dbo.CRM_T1CallbackState(@list,c.Id,c.Phone,@now) affinity
 WHERE timing.Eligible=1 AND affinity.Eligible=1
 -- Brief offer lease lets parallel searches try different contacts; native in-flight
 -- and attempt-limit checks remain authoritative. Rejected offers expire automatically.
 AND (o.OfferedUtc IS NULL OR o.OfferedUtc<=DATEADD(second,-2,@now))
 ORDER BY CASE WHEN affinity.DueUtc IS NOT NULL OR timing.DueAt IS NOT NULL THEN 0 ELSE 1 END,COALESCE(affinity.DueUtc,DATEADD(minute,DATEDIFF(minute,@local,@now),timing.DueAt)),
   CASE WHEN c.Id>@last THEN 0 ELSE 1 END,c.Id;
 IF @next IS NOT NULL BEGIN
   UPDATE dbo.CRM_T1TimeCursor SET LastId=@next WHERE ListId=@list;
   IF @@ROWCOUNT=0 INSERT dbo.CRM_T1TimeCursor VALUES(@list,@next);
   UPDATE dbo.CRM_T1SelectionOffers SET OfferedUtc=@now WHERE ListId=@list AND Id=@next;
   IF @@ROWCOUNT=0 INSERT dbo.CRM_T1SelectionOffers VALUES(@list,@next,@now);
   SET @id=CONVERT(nvarchar(40),@next);
 END;
 COMMIT;
END;
