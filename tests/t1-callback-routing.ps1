$ErrorActionPreference='Stop'
# This test accepts no server parameter: all A_* fixture writes stay in a disposable local DB.
$dbName='CallbackFixture_'+[guid]::NewGuid().ToString('N')
$c=New-Object System.Data.SqlClient.SqlConnection 'Server=(localdb)\MSSQLLocalDB;Integrated Security=True;Database=master'
$c.Open()
function Sql([string]$text) {
 foreach($batch in [regex]::Split($text,'(?im)^GO\s*$')) {
  if(-not $batch.Trim()){continue}
  $q=$c.CreateCommand();$q.CommandTimeout=180;$q.CommandText=$batch
  try{[void]$q.ExecuteNonQuery()}finally{$q.Dispose()}
 }
}
$c.add_InfoMessage({param($sender,$event) Write-Host $event.Message})
try {
 Sql "CREATE DATABASE [$dbName]"; $c.ChangeDatabase($dbName)
 Sql (Get-Content -Raw "$PSScriptRoot/t1-callback-fixture.sql")
 Sql (Get-Content -Raw "$PSScriptRoot/t1-callback-dependencies.sql")
 $routing=Get-Content -Raw "$PSScriptRoot/../scripts/oktell-bridge/sql/t1-callback-routing.sql"
 # Only clocks and cross-database references are substituted in the isolated fixture.
 $routing=$routing.Replace('oktell_settings.dbo.','dbo.').Replace('SYSUTCDATETIME()',"CONVERT(datetime2,'2026-10-30T09:00:00')").Replace('SYSDATETIME()',"CONVERT(datetime2,'2026-10-30T12:00:00')")
 Sql $routing
 Sql (Get-Content -Raw "$PSScriptRoot/t1-callback-routing.sql")
} finally {
 $c.ChangeDatabase('master');Sql "ALTER DATABASE [$dbName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$dbName]"; $c.Close()
}
