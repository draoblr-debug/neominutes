import React, { useState, useEffect, useRef } from "react";
import { Mic, UploadCloud, Users, Mail, Loader2, FileAudio, CheckCircle2, UserPlus, ArrowRight, RefreshCw, Server, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import type { MeetingMinutes, ActionItem } from "./types";
import { generateRandomString, generateCodeChallenge } from "./pkce";

const ORG_CHART = {
  "Engineering": ["Alice Smith", "Bob Jones", "Charlie Davis"],
  "Marketing": ["Diana Prince", "Evan Wright"],
  "HR": ["Fiona Gallagher", "George Costanza"],
  "Management": ["Hannah Abbott", "Ian Malcolm"],
  "Sales": ["Jack Black", "Karen White"]
};

export default function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  
  // MCP State
  const [mcpKey, setMcpKey] = useState(sessionStorage.getItem("mcp_access_token") || "");
  const [mcpResources, setMcpResources] = useState<any[]>([]);
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Speaker Mapping State
  const [speakerMapping, setSpeakerMapping] = useState<Record<string, string>>({});

  // Emailing State
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isExchanging = useRef(false);

  useEffect(() => {
    // Check if returning from OAuth flow
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && window.location.pathname === "/oauth/callback" && !isExchanging.current) {
      isExchanging.current = true;
      setIsConnecting(true);
      const codeVerifier = sessionStorage.getItem("mcp_code_verifier");
      const clientId = sessionStorage.getItem("mcp_client_id");
      const redirectUri = sessionStorage.getItem("mcp_redirect_uri");

      fetch("/api/mcp/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, codeVerifier, clientId, redirectUri })
      })
      .then(res => res.json())
      .then(data => {
        if (data.access_token) {
          sessionStorage.setItem("mcp_access_token", data.access_token);
          setMcpKey(data.access_token);
          // Clean up URL
          window.history.replaceState({}, document.title, "/");
          // Connect to MCP automatically using the token
          return fetch("/api/mcp/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: data.access_token }),
          });
        } else {
          throw new Error(data.error || "Failed to get access token");
        }
      })
      .then(res => {
        if (!res) return;
        return res.json().then(data => {
          if (!res.ok) throw new Error(data.error || "Failed to connect to MCP");
          setMcpResources(data.resources || []);
          setMcpTools(data.tools || []);
          setIsConnected(true);
        });
      })
      .catch(err => setError(err.message))
      .finally(() => {
        setIsConnecting(false);
      });
    }
  }, []);

  const connectToMcp = async () => {
    if (!mcpKey) {
      // Initiate OAuth Flow
      setIsConnecting(true);
      setError(null);
      try {
        const origin = window.location.origin;
        const res = await fetch("/api/mcp/client-id", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ origin })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to get client ID");

        const { clientId, redirectUri } = data;
        
        const codeVerifier = generateRandomString(43);
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        
        sessionStorage.setItem("mcp_code_verifier", codeVerifier);
        sessionStorage.setItem("mcp_client_id", clientId);
        sessionStorage.setItem("mcp_redirect_uri", redirectUri);

        const authUrl = new URL("https://api.neosapien.xyz/mcp/authorize");
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("scope", "mcp");
        
        window.location.href = authUrl.toString();
        return; // Page will redirect
      } catch (err: any) {
        setError(err.message);
        setIsConnecting(false);
        return;
      }
    }

    setIsConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: mcpKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to connect to MCP");
      setMcpResources(data.resources || []);
      setMcpTools(data.tools || []);
      setIsConnected(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const extractFromMcp = async (resourceUri?: string, toolName?: string) => {
    setIsProcessing(true);
    setError(null);
    setMinutes(null);
    setSpeakerMapping({});
    setSendSuccess(false);

    try {
      const res = await fetch("/api/mcp/extract-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceUri, toolName, apiKey: mcpKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to extract minutes");
      setMinutes(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMappingChange = (original: string, mapped: string) => {
    setSpeakerMapping((prev) => ({ ...prev, [original]: mapped }));
  };

  const applySpeakerMapping = () => {
    if (!minutes) return;
    
    let newSummary = minutes.summary;
    let newActionItems = [...minutes.actionItems];
    let newSpeakers = [...(minutes.speakers || [])];
    
    let mappedCount = 0;

    Object.entries(speakerMapping).forEach(([original, mapped]) => {
      if (!mapped) return;
      mappedCount++;
      
      const regex = new RegExp(`\\b${original}\\b`, 'gi');
      newSummary = newSummary.replace(regex, mapped);

      newActionItems = newActionItems.map(item => ({
        ...item,
        task: item.task.replace(regex, mapped),
        assignee: item.assignee.replace(regex, mapped)
      }));

      const speakerIdx = newSpeakers.indexOf(original);
      if (speakerIdx > -1) {
        newSpeakers[speakerIdx] = mapped;
      }
    });

    if (mappedCount > 0) {
      setMinutes({
        ...minutes,
        summary: newSummary,
        actionItems: newActionItems,
        speakers: newSpeakers
      });
      setSpeakerMapping({});
    }
  };

  const handleAddEmail = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = emailInput.trim();
      if (val && /^\S+@\S+\.\S+$/.test(val)) {
        if (!emails.includes(val)) {
          setEmails([...emails, val]);
        }
        setEmailInput("");
      } else {
        setError("Please enter a valid email address.");
      }
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter((e) => e !== emailToRemove));
  };

  const sendEmail = async () => {
    if (!minutes) return;
    if (emails.length === 0) {
      setError("Please add at least one email recipient.");
      return;
    }
    
    setIsSending(true);
    setError(null);
    setSendSuccess(false);

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minutes,
          recipients: emails,
          subject: "Meeting Minutes & Action Items",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email");
      
      setSendSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 selection:bg-neutral-200">
      <header className="bg-white border-b border-neutral-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="p-2 bg-neutral-100 rounded-lg">
            <Mic className="w-5 h-5 text-neutral-700" />
          </div>
          <div>
            <h1 className="font-semibold text-neutral-900">Meeting Minutes Tracker</h1>
            <p className="text-xs text-neutral-500">Connected to Neosapien MCP Server</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 md:py-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Data Source & Participants */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Server className="w-4 h-4 text-neutral-500" />
              1. Neosapien Connection
            </h2>
            
            {!isConnected ? (
              <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-neutral-200 rounded-xl bg-neutral-50/50 text-center">
                <Server className="w-8 h-8 text-neutral-400 mb-3" />
                <p className="text-sm font-medium text-neutral-700">Not Connected</p>
                <p className="text-xs text-neutral-500 mt-1 mb-4">Connect to the Neosapien MCP server to load transcripts and summaries.</p>

                <button
                  onClick={connectToMcp}
                  disabled={isConnecting}
                  className="bg-neutral-900 w-full hover:bg-neutral-800 disabled:bg-neutral-300 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Connect to Neosapien"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Connected to MCP Server
                  </div>
                  <button
                    onClick={() => {
                      sessionStorage.removeItem("mcp_access_token");
                      setMcpKey("");
                      setIsConnected(false);
                      setMcpResources([]);
                      setMcpTools([]);
                    }}
                    className="text-xs font-medium text-green-800 hover:text-green-900 underline"
                  >
                    Disconnect
                  </button>
                </div>
                
                {mcpResources.length === 0 && mcpTools.length === 0 && (
                  <p className="text-xs text-neutral-500 italic">No resources or tools found on server.</p>
                )}

                {mcpResources.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Available Transcripts</h3>
                    <div className="space-y-2">
                      {mcpResources.map((res: any, idx) => (
                        <button
                          key={idx}
                          onClick={() => extractFromMcp(res.uri, undefined)}
                          disabled={isProcessing}
                          className="w-full text-left px-3 py-2 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-lg text-sm flex flex-col gap-1 transition-colors"
                        >
                          <span className="font-medium text-neutral-900 flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-neutral-500" />
                            {res.name || "Conversation"}
                          </span>
                          {res.description && <span className="text-xs text-neutral-500 line-clamp-1">{res.description}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mcpTools.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Extraction Tools</h3>
                    <div className="space-y-2">
                      {mcpTools.map((tool: any, idx) => (
                        <button
                          key={idx}
                          onClick={() => extractFromMcp(undefined, tool.name)}
                          disabled={isProcessing}
                          className="w-full text-left px-3 py-2 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-lg text-sm flex flex-col gap-1 transition-colors"
                        >
                          <span className="font-medium text-neutral-900 flex items-center gap-1.5">
                            <Server className="w-3.5 h-3.5 text-neutral-500" />
                            {tool.name}
                          </span>
                          {tool.description && <span className="text-xs text-neutral-500 line-clamp-1">{tool.description}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                {isProcessing && (
                  <div className="flex items-center justify-center gap-2 text-sm text-neutral-500 mt-4 p-4 border border-dashed rounded-lg bg-neutral-50">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting & Analyzing...
                  </div>
                )}
              </div>
            )}
          </section>

          <section className={cn("bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm transition-opacity", !minutes && "opacity-50 pointer-events-none")}>
             <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-neutral-500" />
              2. Distribution List
            </h2>
            
            <div className="space-y-4">
              <div>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={handleAddEmail}
                  placeholder="Enter email & press enter..."
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900 transition-shadow"
                />
              </div>

              {emails.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {emails.map((email) => (
                    <div key={email} className="inline-flex items-center gap-1.5 bg-neutral-100 px-2.5 py-1 rounded-md text-xs font-medium text-neutral-700">
                      {email}
                      <button onClick={() => removeEmail(email)} className="text-neutral-400 hover:text-neutral-900">
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={sendEmail}
              disabled={isSending || emails.length === 0}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : sendSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Sent Successfully
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  Send to {emails.length} Participants
                </>
              )}
            </button>
          </section>
          
          {error && (
            <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
              {error}
            </div>
          )}
        </div>

        {/* Right Column: Minutes View */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {!minutes ? (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="h-full min-h-[400px] border-2 border-dashed border-neutral-200 rounded-2xl flex flex-col items-center justify-center text-center p-8 bg-neutral-50/50"
              >
                <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
                  <Server className="w-6 h-6 text-neutral-300" />
                </div>
                <h3 className="font-medium text-neutral-900">No Minutes Yet</h3>
                <p className="text-sm text-neutral-500 max-w-sm mt-1">
                  Connect to your Neosapien MCP server on the left and select a conversation to analyze.
                </p>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden"
              >
                <div className="p-6 border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
                  <h2 className="font-semibold text-lg">Meeting Minutes</h2>
                  <span className="px-2.5 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                    Generated
                  </span>
                </div>
                
                <div className="p-6 space-y-8">
                  {/* Speaker Identification */}
                  {minutes.speakers && minutes.speakers.length > 0 && (
                    <section className="p-5 bg-blue-50/50 border border-blue-100 rounded-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                          <UserPlus className="w-4 h-4 text-blue-600" />
                          Identify Speakers
                        </h3>
                        <button 
                          onClick={applySpeakerMapping}
                          disabled={Object.values(speakerMapping).filter(Boolean).length === 0}
                          className="text-xs bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Apply Names
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {minutes.speakers.map(speaker => (
                          <div key={speaker} className="flex items-center gap-3">
                            <span className="text-sm font-medium text-blue-800 min-w-[90px] truncate" title={speaker}>
                              {speaker}
                            </span>
                            <ArrowRight className="w-4 h-4 text-blue-300 flex-shrink-0" />
                            <select
                              className="flex-1 text-sm bg-white border border-blue-200 rounded-lg px-3 py-2 text-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                              value={speakerMapping[speaker] || ""}
                              onChange={e => handleMappingChange(speaker, e.target.value)}
                            >
                              <option value="">Select Staff...</option>
                              {Object.entries(ORG_CHART).map(([dept, staff]) => (
                                <optgroup key={dept} label={dept}>
                                  {staff.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <h3 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
                      <div className="w-1 h-4 bg-neutral-900 rounded-full"></div>
                      Executive Summary
                    </h3>
                    <textarea 
                      className="w-full text-sm text-neutral-700 leading-relaxed bg-neutral-50/50 border border-neutral-200 rounded-xl p-4 min-h-[160px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:bg-white transition-all resize-y"
                      value={minutes.summary}
                      onChange={(e) => setMinutes({...minutes, summary: e.target.value})}
                    />
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
                      <div className="w-1 h-4 bg-blue-600 rounded-full"></div>
                      Action Items
                    </h3>
                    <div className="space-y-3">
                      {minutes.actionItems.map((item, idx) => (
                        <div key={idx} className="flex gap-3 p-4 border border-neutral-100 rounded-xl bg-white shadow-sm">
                          <div className="mt-0.5">
                            <div className="w-4 h-4 rounded border-2 border-neutral-300"></div>
                          </div>
                          <div className="flex-1 space-y-2">
                            <input
                              className="w-full font-medium text-sm text-neutral-900 focus:outline-none focus:border-b border-neutral-300"
                              value={item.task}
                              onChange={(e) => {
                                const newItems = [...minutes.actionItems];
                                newItems[idx].task = e.target.value;
                                setMinutes({...minutes, actionItems: newItems});
                              }}
                            />
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                                <Users className="w-3.5 h-3.5" />
                                <input
                                  className="focus:outline-none focus:text-neutral-900 bg-transparent"
                                  value={item.assignee}
                                  onChange={(e) => {
                                    const newItems = [...minutes.actionItems];
                                    newItems[idx].assignee = e.target.value;
                                    setMinutes({...minutes, actionItems: newItems});
                                  }}
                                />
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                                <span>Due:</span>
                                <input
                                  className="focus:outline-none focus:text-neutral-900 bg-transparent placeholder:text-neutral-400"
                                  placeholder="No deadline"
                                  value={item.deadline || ""}
                                  onChange={(e) => {
                                    const newItems = [...minutes.actionItems];
                                    newItems[idx].deadline = e.target.value;
                                    setMinutes({...minutes, actionItems: newItems});
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      {minutes.actionItems.length === 0 && (
                         <div className="text-sm text-neutral-500 italic p-4 text-center border border-dashed border-neutral-200 rounded-xl">
                           No action items extracted.
                         </div>
                      )}
                    </div>
                  </section>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
