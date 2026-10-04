// Admin CLI: npm run admin -- <command>
//   invites [n]                 create n bootstrap invite codes
//   grant <username> <badge>    grant a badge (staff, developer, founder, bug_hunter, supporter, early_supporter)
//   revoke <username> <badge>
//   role <username> <role,...>  set roles (staff, developer, founder)
//   ban <username> / unban <username>
import { one, run } from './db';
import { makeInviteCodes } from './auth';
import { parse } from './accounts';
import { GRANTABLE } from '../../shared/badges';

const [cmd, a1, a2] = process.argv.slice(2);
const acct = (u: string) => { const a = one('SELECT * FROM accounts WHERE username = ?', (u ?? '').toLowerCase().replace(/^@/, '')); if (!a) { console.error('no such user'); process.exit(1); } return a; };

switch (cmd) {
  case 'invites': console.log(makeInviteCodes(null, Number(a1) || 5).join('\n')); break;
  case 'grant': case 'revoke': {
    const a = acct(a1);
    if (!GRANTABLE.includes(a2 as any)) { console.error(`badge must be one of ${GRANTABLE.join(', ')}`); process.exit(1); }
    const set = new Set<string>(parse(a.badges_json, []));
    cmd === 'grant' ? set.add(a2) : set.delete(a2);
    run('UPDATE accounts SET badges_json = ? WHERE id = ?', JSON.stringify([...set]), a.id);
    console.log(`${a.username}: ${[...set].join(', ') || '(none)'}`);
    break;
  }
  case 'role': {
    const a = acct(a1);
    const roles = (a2 ?? '').split(',').filter((r) => ['staff', 'developer', 'founder'].includes(r));
    run('UPDATE accounts SET roles_json = ? WHERE id = ?', JSON.stringify(roles), a.id);
    console.log(`${a.username}: roles = ${roles.join(', ') || '(none)'}`);
    break;
  }
  case 'ban': case 'unban': run('UPDATE accounts SET banned = ? WHERE id = ?', cmd === 'ban' ? 1 : 0, acct(a1).id); console.log('ok'); break;
  default: console.log('commands: invites [n] | grant <user> <badge> | revoke <user> <badge> | role <user> <roles> | ban <user> | unban <user>');
}
