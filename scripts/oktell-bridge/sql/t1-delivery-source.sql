-- Migration from the empty diagnostic staging source; do not reset existing IDs.
IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryContacts)
 AND IDENT_CURRENT('dbo.CRM_DeliveryContacts')<1000000
BEGIN
 IF EXISTS(SELECT 1 FROM dbo.A_TaskManager_SubTasks WHERE TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND IdInList>=1000000)
  OR EXISTS(SELECT 1 FROM dbo.A_TaskManager_SubTaskEfforts WHERE TaskId='185e121d-d888-4598-85d2-00aa47c825c5' AND IdInList>=1000000)
  THROW 50000,'Reconcile native ID range before attaching source',1;
 DBCC CHECKIDENT('dbo.CRM_DeliveryContacts',RESEED,1000000) WITH NO_INFOMSGS;
END;
GO
-- Apply after delivery-schema.sql, with T1 stopped. Keep archived IDs and receipts
-- so replay cannot revive completed contacts or overwrite native history.
CREATE OR ALTER VIEW dbo.crm_t1_delivery AS
 SELECT c.Id,c.Phone,c.Name,c.ClientId FROM dbo.CRM_DeliveryContacts c
 JOIN dbo.CRM_DeliveryReceipts r ON r.TaskId=c.TaskId AND r.BatchId=c.BatchId
 WHERE c.TaskId='185e121d-d888-4598-85d2-00aa47c825c5'
 AND c.Archived=0 AND r.Cancelled=0 AND r.Completed=0;
GO
CREATE OR ALTER FUNCTION dbo.CRM_T1TimeCandidates(@list uniqueidentifier)
RETURNS TABLE AS RETURN
 SELECT Id,CONVERT(varchar(32),phone) Phone
 FROM dbo.[A_TaskManager_LocalList_4a10515d-518d-463e-bfe8-f0ca3ce11d7d_0]
 WHERE @list='4a10515d-518d-463e-bfe8-f0ca3ce11d7d'
 UNION ALL
 SELECT Id,Phone FROM dbo.crm_t1_delivery
 WHERE @list='fd519550-95d8-45c3-9fb9-be83f3084034';
