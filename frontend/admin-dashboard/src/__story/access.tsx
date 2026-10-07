/* Story harness (7 Oct 2026): Access Control Users / Manage / Deactivate / Delete /
   Audit log, the forced password screen and the new skills editor — mocked fetch.
   ?w=users | manage | deactivate | delete | deleteok | audit | force | skills  */
import { createRoot } from "react-dom/client";
import "../styles.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { CrmMeProvider } from "../crm/CrmApp";
import { UsersAdminPage } from "../crm/pages/UsersAdmin";
import { UserManageModal } from "../crm/components/access/UserManageModal";
import { DeactivateUserModal, DeleteUserModal } from "../crm/components/access/UserLifecycle";
import { AccessAuditLog } from "../crm/components/access/AccessAuditLog";
import { ForcePasswordChange } from "../components/ForcePasswordChange";
import { JdSkillsModal } from "../crm/components/JdSkillsModal";

const q = new URLSearchParams(location.search);
const users = [
  { id: 1, full_name: "Pavan Sanap", username: "pawan_sanap", email: "pavan.sanap@karnex.in", legacy_role: "hr", is_active: true, roles: ["Admin"], custom_roles: [], access_template_id: null, last_login: "2026-10-07T09:12:00+05:30", has_employee: true },
  { id: 2, full_name: "Karan Singh", username: "karan", email: "karan.singh@karnex.in", legacy_role: "hr", is_active: true, roles: ["Admin", "CEO"], custom_roles: [], last_login: "2026-10-07T10:40:00+05:30" },
  { id: 3, full_name: "Gargee Joshi", username: "gargee.joshi@karnex.in", email: "gargee.joshi@karnex.in", legacy_role: "hr", is_active: true, roles: ["TA"], custom_roles: [], access_template_id: 11, last_login: "2026-10-06T18:02:00+05:30", has_employee: true },
  { id: 4, full_name: "Balasaheb Suryawanshi", username: "balasaheb.suryawanshi", email: "balasaheb.suryawanshi@karnex.in", legacy_role: "hr", is_active: true, roles: ["Sales"], custom_roles: ["Sales Manager"], must_change_password: true, last_login: null },
  { id: 5, full_name: "Vishal Harjani", username: "vishal.harjani", email: "vishal.harjani@karnex.in", legacy_role: "hr", is_active: false, roles: ["HR"], custom_roles: [], access_template_id: 12, last_login: "2026-09-02T11:00:00+05:30" },
  { id: 6, full_name: "New Joiner", username: "new.joiner", email: "new.joiner@karnex.in", legacy_role: "hr", is_active: true, roles: [], custom_roles: [], last_login: null },
];
const audit = [
  { id: 9, action: "user.deactivated", label: "Deactivated", group: "account", target_user_id: 5, target_name: "Vishal Harjani", actor_name: "Karan Singh", subject_type: null, subject_name: null, summary: "Deactivated", reason: "Left the company — last working day 30 Sep", at: "2026-10-07T11:02:00+05:30" },
  { id: 8, action: "user.password_reset", label: "Password reset by admin", group: "security", target_user_id: 4, target_name: "Balasaheb Suryawanshi", actor_name: "Karan Singh", subject_type: null, subject_name: null, summary: "Temporary password generated · must change it at next sign-in", reason: null, at: "2026-10-07T10:48:00+05:30" },
  { id: 7, action: "user.roles", label: "Roles changed", group: "access", target_user_id: 4, target_name: "Balasaheb Suryawanshi", actor_name: "Pavan Sanap", subject_type: null, subject_name: null, summary: "Roles: Sales → Sales, Sales Manager", reason: null, at: "2026-10-06T16:20:00+05:30" },
  { id: 6, action: "role.updated", label: "Role edited", group: "roles", target_user_id: null, target_name: null, actor_name: "Pavan Sanap", subject_type: "role", subject_name: "GM", summary: "Role 'GM' edited (action_access, tab_access)", reason: null, at: "2026-10-06T12:05:00+05:30" },
];
const skills = [
  "JIRA|QA", "C++|Embedded", "RTOS|Embedded", "CAPL|Automotive", "Bootloader|Embedded", "AUTOSAR|Automotive",
  "Python|", "CANoe|Automotive", "UDS|Automotive", "ISO 26262|Automotive",
].map((s, i) => ({ id: i + 1, name: s.split("|")[0], category: s.split("|")[1] || null }));

(window as any).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url);
  let body: any = { success: true, data: [] };
  if (u.includes("/api/users/access-log")) body = { success: true, data: u.includes("user_id=4") ? audit.filter((a) => a.target_user_id === 4) : audit, meta: { total: 4, page: 1 } };
  else if (u.includes("/open-work")) body = { success: true, data: q.get("w") === "deleteok" ? { open_work: [], history: [] }
    : { open_work: [{ key: "candidates", label: "Candidates they own as TA", count: 14, hint: "Reassign the TA owner so the candidates' notices reach someone." }, { key: "positions", label: "Positions assigned to them", count: 3, hint: "Change the sourcing team on these positions." }],
        history: [{ label: "candidate activity", count: 212 }, { label: "candidates owned", count: 41 }, { label: "AI interviews scheduled", count: 18 }] } };
  else if (u.startsWith("/api/users")) body = { success: true, data: users, meta: { page: 1, limit: 20, total: 6, pages: 1, counts: { total: 21, active: 19, inactive: 2, no_role: 1, password_pending: 1 } } };
  else if (u.includes("/api/access-templates")) body = { success: true, data: [{ id: 11, name: "Default — TA", is_active: true }, { id: 12, name: "Default — HR", is_active: true }] };
  else if (u.includes("/api/roles")) body = { success: true, data: { custom: [{ id: 1, name: "GM", is_active: true }, { id: 2, name: "Sales Manager", is_active: true }] } };
  else if (u.includes("/api/email-flows")) body = { success: true, data: { flows: [], all_roles: [], paused_user_ids: [5] } };
  else if (u.includes("/api/skills")) body = { success: true, data: skills, meta: { total: skills.length, pages: 1 } };
  else if (u.includes("/attachments")) body = { success: true, data: [] };
  void init;
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
window.history.replaceState(null, "", "?view=crm&p=users");
const me: any = { id: 2, username: "karan", full_name: "Karan Singh", roles: ["Admin", "CEO"], access: { full: true }, approvals: [] };
const noop = () => {};
const actions = { editRoles: noop, tabExceptions: noop, resetPassword: noop, togglePortal: noop, toggleEmail: noop, deactivate: noop, activate: noop, remove: noop };
const req: any = { id: 104, title: "IT&V Engineer [Certification]", req_number: "REQ-2026-043", opportunity_opp_id: "C-2026-00104",
  status: "Pending_Engineering_Review", description: "IT&V Engineer [Certification]",
  rmg_jd_text: "We need an IT&V engineer with C++ and CAPL scripting on CANoe, RTOS exposure and UDS diagnostics. ISO 26262 a plus.",
  skills: [{ skill_id: 1, is_mandatory: true, min_rating: null }, { skill_id: 3, is_mandatory: true, min_rating: 3 }, { skill_id: 3, is_mandatory: false, min_rating: 4 }] };

const w = q.get("w") || "users";
const view = w === "manage" ? <UserManageModal user={users[3] as any} accessLabel="custom role Sales Manager" isSelf={false} emailPaused={false} actions={actions} onClose={noop} />
  : w === "deactivate" ? <DeactivateUserModal user={users[2]} onClose={noop} onDone={noop} />
  : w === "delete" || w === "deleteok" ? <DeleteUserModal user={users[2]} onClose={noop} onDone={noop} onDeactivateInstead={noop} />
  : w === "audit" ? <AccessAuditLog />
  : w === "force" ? <ForcePasswordChange name="Balasaheb" />
  : w === "skills" ? <JdSkillsModal req={req} onClose={noop} onSaved={noop} toast={noop} mode="approve" />
  : <UsersAdminPage />;
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><CrmMeProvider value={me}><div className="p-4">{view}</div></CrmMeProvider></ThemeProvider>);
