-- ALE-41: native settings only for explicitly enrolled lab owners. No activation or calls.
-- Install in oktell. Enroll the dedicated owner separately; empty enrollment denies every request.
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.CRM_LabSettingsOwners') IS NULL
 CREATE TABLE dbo.CRM_LabSettingsOwners(UserId uniqueidentifier NOT NULL PRIMARY KEY);
IF OBJECT_ID('dbo.CRM_LabSettingsTasks') IS NULL
 CREATE TABLE dbo.CRM_LabSettingsTasks(TaskId uniqueidentifier NOT NULL PRIMARY KEY,ProjectId uniqueidentifier NOT NULL UNIQUE,OwnerId uniqueidentifier NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
IF OBJECT_ID('dbo.CRM_LabSettingsWrites') IS NULL
 CREATE TABLE dbo.CRM_LabSettingsWrites(OperationId uniqueidentifier NOT NULL PRIMARY KEY,TaskId uniqueidentifier NOT NULL,InputHash varbinary(32) NOT NULL,AfterHash varchar(64) NOT NULL,At datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
CREATE OR ALTER PROCEDURE dbo.CRM_LabSettingsSnapshot @id uniqueidentifier,@hash varchar(64) OUTPUT,@result nvarchar(max) OUTPUT AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @raw nvarchar(max)=(SELECT t.*,
  (SELECT CONVERT(varbinary(max),p.Stream) Stream FROM dbo.A_TaskManager_TaskProperties p WHERE p.IdTask=t.Id FOR JSON PATH,INCLUDE_NULL_VALUES) Opaque,
  (SELECT * FROM dbo.A_TaskManager_RunPeriods p WHERE p.TaskId=t.Id ORDER BY DayOfWeek,StartTime,FinishTime FOR JSON PATH) Periods,
  (SELECT * FROM dbo.A_TaskManager_Operators p WHERE p.TaskId=t.Id ORDER BY OperatorId FOR JSON PATH) Operators,
  (SELECT * FROM dbo.A_TaskManager_TaskExtLines p WHERE p.TaskId=t.Id ORDER BY ExtLineId FOR JSON PATH) Lines
  FROM dbo.A_TaskManager_Tasks t WHERE t.Id=@id FOR JSON PATH,INCLUDE_NULL_VALUES);
 SET @hash=CONVERT(varchar(64),HASHBYTES('SHA2_256',@raw),2);
 SET @result=(SELECT CAST(1 AS bit) ok,t.Id taskId,t.IdProject projectId,t.Name name,t.Active active,t.TryConnectTime ringSeconds,t.IncomingCallsMaxCount maxLines,
  CASE WHEN t.PredictCall=1 THEN 'predictive' WHEN t.ProgressCall=1 THEN 'progressive' ELSE 'preview' END mode,@hash snapshot,
  JSON_QUERY((SELECT CASE WHEN DayOfWeek=0 THEN 7 ELSE DayOfWeek END day,CONVERT(char(5),StartTime,108) [from],CONVERT(char(5),FinishTime,108) [to] FROM dbo.A_TaskManager_RunPeriods p WHERE p.TaskId=t.Id ORDER BY DayOfWeek,StartTime FOR JSON PATH)) schedule,
  (SELECT COUNT(*) FROM dbo.A_TaskManager_TaskExtLines p WHERE p.TaskId=t.Id) assignedLines
  FROM dbo.A_TaskManager_Tasks t WHERE t.Id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END
GO
CREATE OR ALTER PROCEDURE dbo.CRM_LabProjectSettings
 @input nvarchar(max),@actor uniqueidentifier,@output nvarchar(max) OUTPUT,@refresh nvarchar(10) OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 2000;
 SET @refresh=N'0';SET @output=N'{"ok":false,"error":"denied"}';
 IF @actor IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.CRM_LabSettingsOwners WHERE UserId=@actor) THROW 51001,'Unauthorized lab owner',1;
 IF DATALENGTH(@input)>131072 OR ISJSON(@input)<>1 THROW 51002,'Invalid input',1;
 DECLARE @action nvarchar(10)=JSON_VALUE(@input,'$.action'),@id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@input,'$.taskId')),
 @project uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@input,'$.projectId')),
 @operation uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@input,'$.operationId')),
 @expected varchar(64)=JSON_VALUE(@input,'$.expected'),@hash varchar(64),@result nvarchar(max);
 IF @id IS NULL OR @project IS NULL OR @action NOT IN ('read','save') OR @action IS NULL THROW 51002,'Invalid identity or action',1;
 BEGIN TRY
  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  BEGIN TRANSACTION;
  DECLARE @lock int;EXEC @lock=sys.sp_getapplock @Resource='CRM_LabProjectSettings',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=2000;
  IF @lock<0 THROW 51003,'Lab settings busy',1;
  DECLARE @known bit=CASE WHEN EXISTS(SELECT 1 FROM dbo.CRM_LabSettingsTasks WHERE TaskId=@id AND ProjectId=@project AND OwnerId=@actor) THEN 1 ELSE 0 END;
  IF @known=0 AND (@action<>'save' OR EXISTS(SELECT 1 FROM dbo.A_TaskManager_Tasks WHERE Id=@id OR IdProject=@project)
   OR EXISTS(SELECT 1 FROM dbo.CRM_LabSettingsTasks WHERE TaskId=@id OR ProjectId=@project)
   OR NOT EXISTS(SELECT 1 FROM dbo.A_TaskManager_Projects WHERE Id=@project AND IdCreator=@actor AND Name LIKE N'LAB[_]SETTINGS[_]%'))
   THROW 51001,'Project outside isolated scope',1;
  IF @known=1 AND NOT EXISTS(SELECT 1 FROM dbo.A_TaskManager_Tasks WHERE Id=@id AND IdProject=@project AND CreationUserId=@actor) THROW 51004,'Native task identity changed',1;
  IF @action='read' BEGIN
   EXEC dbo.CRM_LabSettingsSnapshot @id,@hash OUTPUT,@output OUTPUT;
   COMMIT;RETURN;
  END;
  IF @operation IS NULL THROW 51002,'Missing operation id',1;
  IF EXISTS(SELECT 1 FROM dbo.A_TaskManager_Tasks WHERE Active<>0) THROW 51005,'Task refresh deferred: an active native task exists',1;
  IF EXISTS(SELECT 1 FROM dbo.A_TaskManager_Tasks WHERE Id=@id AND (Active<>0 OR ListId<>'00000000-0000-0000-0000-000000000000' OR DirectDbMethod<>0 OR DirectDbMethodProc<>''))
   OR EXISTS(SELECT 1 FROM dbo.A_TaskManager_TaskExtLines WHERE TaskId=@id) THROW 51004,'Task is no longer isolated',1;
  IF @known=1 EXEC dbo.CRM_LabSettingsSnapshot @id,@hash OUTPUT,@result OUTPUT;
  DECLARE @inputHash varbinary(32)=HASHBYTES('SHA2_256',@input);
  IF EXISTS(SELECT 1 FROM dbo.CRM_LabSettingsWrites WHERE OperationId=@operation) BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.CRM_LabSettingsWrites WHERE OperationId=@operation AND TaskId=@id AND InputHash=@inputHash AND AfterHash=@hash) THROW 51006,'Operation conflict',1;
   SET @output=@result;SET @refresh=N'1';COMMIT;RETURN;
  END;
  IF (@known=1 AND (@expected IS NULL OR @hash<>@expected)) OR (@known=0 AND @expected IS NOT NULL) THROW 51006,'Snapshot conflict',1;
  DECLARE @name nvarchar(500)=JSON_VALUE(@input,'$.settings.name'),@mode nvarchar(30)=JSON_VALUE(@input,'$.settings.mode'),
   @ring int=TRY_CONVERT(int,JSON_VALUE(@input,'$.settings.ringSeconds')),@lines int=TRY_CONVERT(int,JSON_VALUE(@input,'$.settings.maxLines'));
  IF @name IS NULL OR LEN(LTRIM(RTRIM(@name))) NOT BETWEEN 1 AND 100 OR @mode IS NULL OR @mode NOT IN ('preview','progressive','predictive')
   OR @ring IS NULL OR @ring NOT BETWEEN 10 AND 180 OR @lines IS NULL OR @lines NOT BETWEEN 1 AND 100
   OR ISNULL(JSON_VALUE(@input,'$.settings.timezone'),'')<>'Europe/Moscow' THROW 51002,'Invalid basic settings or timezone',1;
  DECLARE @periods TABLE(dow int,st nvarchar(20),fin nvarchar(20));
  IF LEFT(ISNULL(JSON_QUERY(@input,'$.settings.schedule'),''),1)<>'[' THROW 51002,'Schedule required',1;
  INSERT INTO @periods SELECT day,[from],[to] FROM OPENJSON(@input,'$.settings.schedule') WITH(day int,[from] nvarchar(20),[to] nvarchar(20));
  IF (SELECT COUNT(*) FROM @periods) NOT BETWEEN 1 AND 28 OR EXISTS(SELECT 1 FROM @periods WHERE dow IS NULL OR dow NOT BETWEEN 1 AND 7
   OR st IS NULL OR fin IS NULL OR LEN(st)<>5 OR LEN(fin)<>5 OR TRY_CONVERT(time,st) IS NULL OR TRY_CONVERT(time,fin) IS NULL OR st>=fin)
   THROW 51002,'Invalid schedule',1;
  IF EXISTS(SELECT 1 FROM @periods a JOIN @periods b ON a.dow=b.dow AND a.st<b.fin AND b.st<a.fin AND (a.st<>b.st OR a.fin<>b.fin))
   OR EXISTS(SELECT dow,st,fin FROM @periods GROUP BY dow,st,fin HAVING COUNT(*)>1) THROW 51002,'Overlapping schedule',1;
  DECLARE @t_id uniqueidentifier,
   @t_idproject uniqueidentifier,
   @t_name nvarchar(500),
   @t_active int,
   @t_done int,
   @t_type int,
   @t_ivrname nvarchar(500),
   @t_stopreason int,
   @t_talkscript nvarchar(500),
   @t_pausewhenbusy float,
   @t_pausewhennotrespond float,
   @t_maxeffortcountbusy int,
   @t_maxeffortcountnotrespond int,
   @t_mintimetocheckdone int,
   @t_tryconnecttime int,
   @t_choiceoperator int,
   @t_deleteaftersuccess int,
   @t_isextnumber int,
   @t_isoutputtask int,
   @t_resulted int,
   @t_resulttype int,
   @t_resultinfo nvarchar(500),
   @t_resultdatetime datetime,
   @t_creationuserid uniqueidentifier,
   @t_creationtype int,
   @t_creationdatetime datetime,
   @t_startrundatetime datetime,
   @t_stoprundatetime datetime,
   @t_canadddynamically int,
   @t_tagdouble float,
   @t_listid uniqueidentifier,
   @t_operatorshowquery bit,
   @t_operatorshownotify bit,
   @t_progresscall bit,
   @t_progresscallmaxcount int,
   @t_progresscallkeepqueue bit,
   @t_predictcall bit,
   @t_predictcalloffsetsec int,
   @t_queueuse bit,
   @t_queuemaxcount int,
   @t_queuemusic nvarchar(500),
   @t_queueloyality int,
   @t_choiceabonents int,
   @t_choicenumber int,
   @t_choicetable int,
   @t_choiceprogress int,
   @t_dontsetdone bit,
   @t_pausesynclistwaitingnewabonent int,
   @t_incomingcallsmaxcount int,
   @t_servicescript nvarchar(200),
   @t_dialcallerid nvarchar(20),
   @t_incomingupdateifexists bit,
   @t_activeonholidays bit,
   @t_code nvarchar(30),
   @t_pausesynclistforcedsec int,
   @t_queuemaxtimeminutes int,
   @t_predictcallerrprobability int,
   @t_queuerandomfrompath nvarchar(200),
   @t_savedb bit,
   @t_directdbmethod int,
   @t_directdbmethodproc nvarchar(200),
   @t_streamparams varbinary(max),
   @t_iduser uniqueidentifier;
  SELECT @t_id=@id,
   @t_idproject=@project,
   @t_name=N'CRM NO CALLS 20261023',
   @t_active=0,
   @t_done=0,
   @t_type=20,
   @t_ivrname=N'',
   @t_stopreason=0,
   @t_talkscript=N'',
   @t_pausewhenbusy=30,
   @t_pausewhennotrespond=600,
   @t_maxeffortcountbusy=25,
   @t_maxeffortcountnotrespond=5,
   @t_mintimetocheckdone=0,
   @t_tryconnecttime=40,
   @t_choiceoperator=5,
   @t_deleteaftersuccess=0,
   @t_isextnumber=1,
   @t_isoutputtask=1,
   @t_resulted=0,
   @t_resulttype=0,
   @t_resultinfo=N'',
   @t_resultdatetime=CONVERT(datetime,'19000101',112),
   @t_creationuserid=@actor,
   @t_creationtype=2,
   @t_creationdatetime=GETDATE(),
   @t_startrundatetime=CONVERT(datetime,'19000101',112),
   @t_stoprundatetime=CONVERT(datetime,'19000101',112),
   @t_canadddynamically=0,
   @t_tagdouble=0,
   @t_listid=N'00000000-0000-0000-0000-000000000000',
   @t_operatorshowquery=0,
   @t_operatorshownotify=0,
   @t_progresscall=0,
   @t_progresscallmaxcount=0,
   @t_progresscallkeepqueue=0,
   @t_predictcall=0,
   @t_predictcalloffsetsec=0,
   @t_queueuse=0,
   @t_queuemaxcount=0,
   @t_queuemusic=N'',
   @t_queueloyality=0,
   @t_choiceabonents=2,
   @t_choicenumber=1,
   @t_choicetable=1,
   @t_choiceprogress=0,
   @t_dontsetdone=0,
   @t_pausesynclistwaitingnewabonent=60,
   @t_incomingcallsmaxcount=0,
   @t_servicescript=N'',
   @t_dialcallerid=N'',
   @t_incomingupdateifexists=0,
   @t_activeonholidays=0,
   @t_code=N'',
   @t_pausesynclistforcedsec=3600,
   @t_queuemaxtimeminutes=0,
   @t_predictcallerrprobability=5,
   @t_queuerandomfrompath=N'',
   @t_savedb=1,
   @t_directdbmethod=0,
   @t_directdbmethodproc=N'',
   @t_streamparams=NULL,
   @t_iduser=@actor;
  IF @known=1 BEGIN
   SELECT @t_id=t.[Id],
    @t_idproject=t.[IdProject],
    @t_name=t.[Name],
    @t_active=t.[Active],
    @t_done=t.[Done],
    @t_type=t.[Type],
    @t_ivrname=t.[IvrName],
    @t_stopreason=t.[StopReason],
    @t_talkscript=t.[TalkScript],
    @t_pausewhenbusy=t.[PauseWhenBusy],
    @t_pausewhennotrespond=t.[PauseWhenNotRespond],
    @t_maxeffortcountbusy=t.[MaxEffortCountBusy],
    @t_maxeffortcountnotrespond=t.[MaxEffortCountNotRespond],
    @t_mintimetocheckdone=t.[MinTimeToCheckDone],
    @t_tryconnecttime=t.[TryConnectTime],
    @t_choiceoperator=t.[ChoiceOperator],
    @t_deleteaftersuccess=t.[DeleteAfterSuccess],
    @t_isextnumber=t.[IsExtNumber],
    @t_isoutputtask=t.[IsOutputTask],
    @t_resulted=t.[Resulted],
    @t_resulttype=t.[ResultType],
    @t_resultinfo=t.[ResultInfo],
    @t_resultdatetime=t.[ResultDateTime],
    @t_creationuserid=t.[CreationUserId],
    @t_creationtype=t.[CreationType],
    @t_creationdatetime=t.[CreationDateTime],
    @t_startrundatetime=t.[StartRunDateTime],
    @t_stoprundatetime=t.[StopRunDateTime],
    @t_canadddynamically=t.[CanAddDynamically],
    @t_tagdouble=t.[TagDouble],
    @t_listid=t.[ListId],
    @t_operatorshowquery=t.[OperatorShowQuery],
    @t_operatorshownotify=t.[OperatorShowNotify],
    @t_progresscall=t.[ProgressCall],
    @t_progresscallmaxcount=t.[ProgressCallMaxCount],
    @t_progresscallkeepqueue=t.[ProgressCallKeepQueue],
    @t_predictcall=t.[PredictCall],
    @t_predictcalloffsetsec=t.[PredictCallOffsetSec],
    @t_queueuse=t.[QueueUse],
    @t_queuemaxcount=t.[QueueMaxCount],
    @t_queuemusic=t.[QueueMusic],
    @t_queueloyality=t.[QueueLoyality],
    @t_choiceabonents=t.[ChoiceAbonent],
    @t_choicenumber=t.[ChoiceNumber],
    @t_choicetable=t.[ChoiceTable],
    @t_choiceprogress=t.[ChoiceProgress],
    @t_dontsetdone=t.[DontSetDone],
    @t_pausesynclistwaitingnewabonent=t.[PauseSyncListWaitingNewAbonent],
    @t_incomingcallsmaxcount=t.[IncomingCallsMaxCount],
    @t_servicescript=t.[ServiceScript],
    @t_dialcallerid=t.[DialCallerId],
    @t_incomingupdateifexists=t.[IncomingUpdateIfExists],
    @t_activeonholidays=t.[ActiveOnHolidays],
    @t_code=t.[Code],
    @t_pausesynclistforcedsec=t.[PauseSyncListForcedSec],
    @t_queuemaxtimeminutes=t.[QueueMaxTimeMinutes],
    @t_predictcallerrprobability=t.[PredictCallErrProbability],
    @t_queuerandomfrompath=t.[QueueRandomFromPath],
    @t_savedb=t.[SaveDB],
    @t_directdbmethod=t.[DirectDbMethod],
    @t_directdbmethodproc=t.[DirectDbMethodProc] FROM dbo.A_TaskManager_Tasks t WITH (UPDLOCK) WHERE t.Id=@id;
   SELECT @t_streamparams=CONVERT(varbinary(max),Stream) FROM dbo.A_TaskManager_TaskProperties WHERE IdTask=@id;
  END;
  SET @t_name=@name;SET @t_tryconnecttime=@ring;SET @t_incomingcallsmaxcount=@lines;
  SET @t_progresscall=CASE WHEN @mode IN ('progressive','predictive') THEN 1 ELSE 0 END;
  SET @t_predictcall=CASE WHEN @mode='predictive' THEN 1 ELSE 0 END;
  SET @t_active=0;SET @t_iduser=@actor;
  EXEC dbo.A_TaskManager_Task_Save @id=@t_id,
   @idproject=@t_idproject,
   @name=@t_name,
   @active=@t_active,
   @done=@t_done,
   @type=@t_type,
   @ivrname=@t_ivrname,
   @stopreason=@t_stopreason,
   @talkscript=@t_talkscript,
   @pausewhenbusy=@t_pausewhenbusy,
   @pausewhennotrespond=@t_pausewhennotrespond,
   @maxeffortcountbusy=@t_maxeffortcountbusy,
   @maxeffortcountnotrespond=@t_maxeffortcountnotrespond,
   @mintimetocheckdone=@t_mintimetocheckdone,
   @tryconnecttime=@t_tryconnecttime,
   @choiceoperator=@t_choiceoperator,
   @deleteaftersuccess=@t_deleteaftersuccess,
   @isextnumber=@t_isextnumber,
   @isoutputtask=@t_isoutputtask,
   @resulted=@t_resulted,
   @resulttype=@t_resulttype,
   @resultinfo=@t_resultinfo,
   @resultdatetime=@t_resultdatetime,
   @creationuserid=@t_creationuserid,
   @creationtype=@t_creationtype,
   @creationdatetime=@t_creationdatetime,
   @startrundatetime=@t_startrundatetime,
   @stoprundatetime=@t_stoprundatetime,
   @canadddynamically=@t_canadddynamically,
   @tagdouble=@t_tagdouble,
   @listid=@t_listid,
   @operatorshowquery=@t_operatorshowquery,
   @operatorshownotify=@t_operatorshownotify,
   @progresscall=@t_progresscall,
   @progresscallmaxcount=@t_progresscallmaxcount,
   @progresscallkeepqueue=@t_progresscallkeepqueue,
   @predictcall=@t_predictcall,
   @predictcalloffsetsec=@t_predictcalloffsetsec,
   @queueuse=@t_queueuse,
   @queuemaxcount=@t_queuemaxcount,
   @queuemusic=@t_queuemusic,
   @queueloyality=@t_queueloyality,
   @choiceabonents=@t_choiceabonents,
   @choicenumber=@t_choicenumber,
   @choicetable=@t_choicetable,
   @choiceprogress=@t_choiceprogress,
   @dontsetdone=@t_dontsetdone,
   @pausesynclistwaitingnewabonent=@t_pausesynclistwaitingnewabonent,
   @incomingcallsmaxcount=@t_incomingcallsmaxcount,
   @servicescript=@t_servicescript,
   @dialcallerid=@t_dialcallerid,
   @incomingupdateifexists=@t_incomingupdateifexists,
   @activeonholidays=@t_activeonholidays,
   @code=@t_code,
   @pausesynclistforcedsec=@t_pausesynclistforcedsec,
   @queuemaxtimeminutes=@t_queuemaxtimeminutes,
   @predictcallerrprobability=@t_predictcallerrprobability,
   @queuerandomfrompath=@t_queuerandomfrompath,
   @savedb=@t_savedb,
   @directdbmethod=@t_directdbmethod,
   @directdbmethodproc=@t_directdbmethodproc,
   @streamparams=@t_streamparams,
   @iduser=@t_iduser;
  DECLARE @xml nvarchar(max)=CONVERT(nvarchar(max),(SELECT dow%7 [@dow],N'1900-01-01T'+st+N':00' [@start],N'1900-01-01T'+fin+N':00' [@fin] FROM @periods FOR XML PATH('p'),ROOT('items')));
  EXEC dbo.A_TaskManager_Task_PeriodsSave @taskid=@id,@xml=@xml,@authorizeduserid=@actor;
  IF @known=0 INSERT dbo.CRM_LabSettingsTasks(TaskId,ProjectId,OwnerId) VALUES(@id,@project,@actor);
  EXEC dbo.CRM_LabSettingsSnapshot @id,@hash OUTPUT,@output OUTPUT;
  INSERT dbo.CRM_LabSettingsWrites(OperationId,TaskId,InputHash,AfterHash) VALUES(@operation,@id,@inputHash,@hash);
  SET @refresh=N'1';COMMIT;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK;
  SET @refresh=N'0';SET @output=(SELECT CAST(0 AS bit) ok,ERROR_NUMBER() code,ERROR_MESSAGE() error FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END CATCH
END
GO
