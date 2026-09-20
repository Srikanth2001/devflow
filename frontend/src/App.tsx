import { useEffect, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { Activity, CheckCircle2, Circle, Clock3, KanbanSquare, LogOut, Plus, ShieldCheck, Users } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const SOCKET = API.replace(/\/api$/, "");
const api = axios.create({ baseURL: API });

type Task = { id:string; title:string; status:string; priority:string; assignee?:{name:string}; };
type Project = { id:string; name:string; key:string; description?:string; _count?:{tasks:number} };

function Login({ onLogin }: { onLogin:(token:string)=>void }) {
  const [email,setEmail]=useState("demo@devflow.local");
  const [password,setPassword]=useState("Password123!");
  const [error,setError]=useState("");
  async function submit(e:React.FormEvent) {
    e.preventDefault(); setError("");
    try { const r=await api.post("/auth/login",{email,password}); localStorage.setItem("token",r.data.accessToken); onLogin(r.data.accessToken); }
    catch { setError("Login failed. Run the seed and use the demo credentials."); }
  }
  return <main className="auth"><form onSubmit={submit} className="card auth-card">
    <div className="brand"><KanbanSquare/> DevFlow</div><h1>Engineering workspace</h1><p>Manage projects, tasks and team collaboration.</p>
    <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email"/>
    <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password"/>
    {error && <div className="error">{error}</div>}<button>Sign in</button>
  </form></main>
}

function App() {
  const [token,setToken]=useState(localStorage.getItem("token"));
  const [projects,setProjects]=useState<Project[]>([]);
  const [projectId,setProjectId]=useState("");
  const [tasks,setTasks]=useState<Task[]>([]);
  const [activity,setActivity]=useState<any[]>([]);
  const [newTask,setNewTask]=useState("");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{ if(!token)return; api.defaults.headers.common.Authorization=`Bearer ${token}`;
    api.get("/projects").then(r=>{setProjects(r.data); if(r.data[0])setProjectId(r.data[0].id)}).finally(()=>setLoading(false));
  },[token]);

  useEffect(()=>{ if(!token||!projectId)return; api.get("/tasks",{params:{projectId}}).then(r=>setTasks(r.data)); api.get(`/projects/${projectId}/activity`).then(r=>setActivity(r.data));
    const socket=io(SOCKET); socket.emit("project:join",projectId); socket.on("task:created",(t:Task)=>setTasks(x=>[t,...x])); socket.on("task:updated",(t:Task)=>setTasks(x=>x.map(a=>a.id===t.id?{...a,...t}:a)));
    return()=>{socket.disconnect()};
  },[token,projectId]);

  if(!token)return <Login onLogin={setToken}/>;
  if(loading)return <div className="loading">Loading DevFlow…</div>;

  const grouped=(status:string)=>tasks.filter(t=>t.status===status);
  async function addTask(){ if(!newTask.trim()||!projectId)return; const r=await api.post("/tasks",{projectId,title:newTask,priority:"MEDIUM"}); setTasks(x=>[r.data,...x]); setNewTask(""); }
  async function move(id:string,status:string){ await api.patch(`/tasks/${id}`,{status}); setTasks(x=>x.map(t=>t.id===id?{...t,status}:t)); }

  const columns=[["BACKLOG","Backlog"],["TODO","To do"],["IN_PROGRESS","In progress"],["REVIEW","Review"],["DONE","Done"]];
  return <div className="app">
    <aside><div className="brand"><KanbanSquare/> DevFlow</div><div className="workspace"><small>WORKSPACE</small><b>Acme Engineering</b></div>
      <nav><span className="active"><KanbanSquare/> Projects</span><span><Users/> Members</span><span><ShieldCheck/> Roles & Access</span><span><Activity/> Activity</span></nav>
      <button className="logout" onClick={()=>{localStorage.removeItem("token");setToken(null)}}><LogOut/> Sign out</button>
    </aside>
    <section className="content"><header><div><p className="eyebrow">PROJECT</p><h1>{projects.find(p=>p.id===projectId)?.name||"Projects"}</h1></div><select value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}</select></header>
      <div className="stats"><div><span>Tasks</span><strong>{tasks.length}</strong></div><div><span>Completed</span><strong>{grouped("DONE").length}</strong></div><div><span>In progress</span><strong>{grouped("IN_PROGRESS").length}</strong></div><div><span>Open</span><strong>{tasks.filter(t=>t.status!=="DONE").length}</strong></div></div>
      <div className="create"><input value={newTask} onChange={e=>setNewTask(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTask()} placeholder="Create a task…"/><button onClick={addTask}><Plus/> Add task</button></div>
      <div className="board">{columns.map(([status,label])=><div className="column" key={status}><div className="column-title"><span>{label}</span><b>{grouped(status).length}</b></div>{grouped(status).map(t=><article className="task" key={t.id}><div className="priority">{t.priority}</div><h3>{t.title}</h3><p>{t.assignee?.name||"Unassigned"}</p><div className="task-actions">{status!=="DONE"&&<button onClick={()=>move(t.id,status==="BACKLOG"?"TODO":status==="TODO"?"IN_PROGRESS":status==="IN_PROGRESS"?"REVIEW":"DONE")}><CheckCircle2/> Move</button>}</div></article>)}</div>)}</div>
      <section className="activity"><h2>Recent activity</h2>{activity.slice(0,6).map(a=><div className="activity-row" key={a.id}><Clock3/><span><b>{a.actor?.name}</b> {a.details}<small>{new Date(a.createdAt).toLocaleString()}</small></span></div>)}</section>
    </section>
  </div>
}
export default App;
