-- T1: due operator callbacks first, ordinary contacts by completed dial attempts.
-- Native terminal results, retry dates, client windows and owner readiness remain mandatory.
-- Apply only while T1 is stopped; never resets native history.
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
 LEFT JOIN (SELECT e.IdInList,e.Number,COUNT(DISTINCT COALESCE(NULLIF(e.ConnectionChainId,'00000000-0000-0000-0000-000000000000'),e.Id)) Attempts
  FROM dbo.A_TaskManager_SubTaskEfforts e
  WHERE e.TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND e.EResult NOT IN (12,16,17)
  GROUP BY e.IdInList,e.Number) attempts ON attempts.IdInList=c.Id AND attempts.Number=c.Phone
 OUTER APPLY (SELECT TOP(1) e.EDateTime,e.EResult FROM dbo.A_TaskManager_SubTaskEfforts e
  WHERE e.TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND e.IdInList=c.Id AND e.Number=c.Phone
  AND e.EResult NOT IN (12,16,17) ORDER BY e.EDateTime DESC,e.Id DESC) lastEffort
 WHERE timing.Eligible=1 AND affinity.Eligible=1 AND COALESCE(attempts.Attempts,0)<3
 AND (lastEffort.EDateTime IS NULL OR DATEADD(minute,
   CASE WHEN lastEffort.EResult IN (1,2,3) THEN 30 WHEN lastEffort.EResult IN (6,7,13) THEN 5
    WHEN lastEffort.EResult=15 THEN 60 ELSE 0 END,lastEffort.EDateTime)<=@local)
 -- Brief offer lease lets parallel searches try different contacts; native in-flight
 -- and attempt-limit checks remain authoritative. Rejected offers expire automatically.
 AND (o.OfferedUtc IS NULL OR o.OfferedUtc<=DATEADD(second,-2,@now))
 ORDER BY CASE WHEN affinity.DueUtc IS NOT NULL THEN 0 ELSE 1 END,affinity.DueUtc,COALESCE(attempts.Attempts,0),
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
