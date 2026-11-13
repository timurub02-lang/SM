import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch,MagicMock
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('deploy',root/'scripts/deploy-crm.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

class BlueGreen(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=pathlib.Path(self.tmp.name);self.patch=patch.object(d,'BASE',self.base);self.patch.start();self.addCleanup(self.patch.stop)
        self.old=self.release('a');self.new=self.release('b')
        (self.base/'current').symlink_to(self.old)
        self.state={'active':'blue','slots':{'blue':{'release':self.old.name}}}
        self.deployment={'current':self.old.name,'history':[self.old.name]}
        d.write_json(self.base/'blue-green.json',self.state);d.write_json(self.base/'deploy-state.json',self.deployment)
    def release(self,letter):
        path=self.base/'releases'/('gh-'+letter*40);static=path/'.next/standalone/.next/static';static.mkdir(parents=True)
        (static/(letter+'.js')).write_text(letter)
        d.write_json(path/'release.json',{'commit':letter*40,'staticFiles':[letter+'.js'],'legacySnapshots':1})
        return path
    def test_buffered_upload_and_long_websocket_defer_without_stopping(self):
        self.state['slots']['green']={'release':self.new.name};self.state['draining']={'slot':'green','workers':[[45,'birth','boot']]}
        d.write_json(self.base/'blue-green.json',self.state)
        with patch.object(d,'process_identity',return_value=[45,'birth','boot']),patch.object(d.subprocess,'run') as run:
            self.assertFalse(d.reap_slots());run.assert_not_called()
        with patch.object(d,'process_identity',return_value=[45,'other-birth','boot']),patch.object(d.subprocess,'run') as run:
            self.assertTrue(d.reap_slots());self.assertEqual(len(run.call_args_list),4)
            self.assertEqual(list(d.slots()['slots']),['blue'])
    def test_cleanup_keeps_release_in_live_slot_even_outside_history(self):
        older=self.release('c');extra=self.release('d');self.state['slots']['green']={'release':extra.name}
        d.write_json(self.base/'blue-green.json',self.state)
        d.retain([self.old.name,self.new.name,older.name],self.old)
        self.assertTrue(extra.exists());self.assertTrue((self.base/'static/d.js').exists())
    def test_static_collision_is_rejected_and_rollback_chunks_survive(self):
        d.publish_static([self.old.name,self.new.name]);self.assertEqual((self.base/'static/b.js').read_text(),'b')
        (self.base/'static/a.js').write_text('wrong')
        with self.assertRaisesRegex(ValueError,'collision'):d.publish_static([self.old.name])
    def test_unhealthy_candidate_recovers_old_without_database_restore(self):
        with patch.object(d,'prepare_slot',side_effect=RuntimeError('unhealthy')),patch.object(d,'healthy'),patch.object(d,'nginx_workers',return_value=[[1,'2','3']]),patch.object(d,'route_slot') as route,patch.object(d,'restart_workers'),patch.object(d,'idle',return_value=True):
            with self.assertRaisesRegex(RuntimeError,'unhealthy'):d.activate_slots(self.new,self.old,self.deployment)
        self.assertEqual(d.current(),self.old);self.assertEqual(d.slots()['active'],'blue')
        self.assertEqual([c.args[0] for c in route.call_args_list],['blue'])
        self.assertTrue((self.base/'deploy-paused').exists());self.assertFalse((self.base/'blue-green-pending.json').exists())
    def test_crash_after_current_switch_recovers_even_while_paused(self):
        d.write_json(self.base/'blue-green-pending.json',{'before':self.state,'candidate':'green','slot':{'release':self.new.name},'deployState':self.deployment})
        d.point_current(self.new);(self.base/'deploy-paused').touch()
        with patch.object(d,'healthy'),patch.object(d,'nginx_workers',return_value=[]),patch.object(d,'route_slot'),patch.object(d,'restart_workers'):
            d.recover_slots();d.recover_slots()
        self.assertEqual(d.current(),self.old);self.assertEqual(d.slots()['draining']['slot'],'green')
        self.assertEqual(json.loads((self.base/'deploy-state.json').read_text()),self.deployment)
    def test_success_keeps_old_live_and_commits_matching_state(self):
        with patch.object(d,'prepare_slot'),patch.object(d,'nginx_workers',return_value=[[1,'2','3']]),patch.object(d,'route_slot'),patch.object(d,'restart_workers'),patch.object(d,'idle',return_value=True),patch.object(d,'reap_slots',return_value=False):
            self.assertTrue(d.activate_slots(self.new,self.old,self.deployment))
        self.assertEqual(d.current(),self.new);self.assertEqual(d.slots()['active'],'green')
        self.assertTrue(self.old.exists());self.assertEqual(d.slots()['draining']['slot'],'blue')
        self.assertFalse((self.base/'blue-green-pending.json').exists())
    def test_failed_reload_and_worker_restart_both_rollback(self):
        for failure in ['reload','worker']:
            with self.subTest(failure=failure):
                self.setUp()
                with patch.object(d,'prepare_slot'),patch.object(d,'healthy'),patch.object(d,'nginx_workers',return_value=[]),patch.object(d,'idle',return_value=True),patch.object(d,'route_slot',side_effect=[RuntimeError('reload'),None] if failure=='reload' else None),patch.object(d,'restart_workers',side_effect=[RuntimeError('worker'),None] if failure=='worker' else None):
                    with self.assertRaises(RuntimeError):d.activate_slots(self.new,self.old,self.deployment)
                self.assertEqual(d.current(),self.old);self.assertEqual(d.slots()['active'],'blue')
    def test_pending_call_does_not_send_candidate_traffic(self):
        with patch.object(d,'prepare_slot'),patch.object(d,'healthy'),patch.object(d,'nginx_workers',return_value=[]),patch.object(d,'route_slot') as route,patch.object(d,'restart_workers'),patch.object(d,'idle',return_value=False):
            with self.assertRaisesRegex(RuntimeError,'Active call'):d.activate_slots(self.new,self.old,self.deployment)
            self.assertEqual([c.args[0] for c in route.call_args_list],['blue'])
    def test_templates_pin_releases_and_never_force_kill(self):
        for kind in ['web','snapshot']:
            unit=(root/('deploy/sm-crm-'+kind+'@.service')).read_text()
            self.assertNotIn('/srv/crm/current',unit)
            for expected in ['TimeoutStopSec=infinity','SendSIGKILL=no','/srv/crm/slots/%i','EnvironmentFile=/etc/sm-crm.env']:self.assertIn(expected,unit)
        self.assertIn('TimeoutStartSec=infinity',(root/'deploy/sm-crm-deploy.service').read_text())

if __name__=='__main__':unittest.main()
