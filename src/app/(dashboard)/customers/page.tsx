"use client";

import { Header } from "@/components/layout/header";
import { CompanyNameLookup } from "@/components/company-name-lookup";
import { Modal } from "@/components/ui/modal";
import {
  Search,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Trash2,
  ShieldOff,
  ShieldAlert,
  MessageSquare,
  StickyNote,
  Send,
  Mail,
  Phone,
  MessageCircle,
  Contact,
  Clock,
  User,
  Upload,
  Globe,
  Building2,
  MapPin,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cn, formatDate, getStatusColor, getChannelLabel } from "@/lib/utils";
import { getCustomerImportCsvHeaders, parseCustomerImportCsv, type CustomerImportField, type CustomerImportMapping } from "@/lib/customer-import";

// ---------- Types ----------

interface CustomerNoteData {
  id: string;
  customerId: string;
  content: string;
  authorName: string;
  createdAt: string;
}

interface ConversationData {
  id: string;
  channel: string;
  customerName: string;
  customerContact: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface CustomerData {
  id: string;
  name: string;
  companyName: string;
  businessType: string;
  companyAddress: string;
  website: string;
  email: string;
  phone: string;
  whatsapp: string;
  tags: string;
  isBlocked: boolean;
  notes: CustomerNoteData[];
  metadata: Record<string, unknown>;
  firstContact: string;
  lastContact: string;
  conversations?: ConversationData[];
  _count: { notes: number };
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface CompanyLookupMatch {
  customerId: string;
  phone: string;
  candidates: { name: string; sourceUrl: string; token: string }[];
}

// ---------- Tag colors ----------

const tagColors = [
  "bg-blue-100 text-blue-700",
  "bg-green-100 text-green-700",
  "bg-purple-100 text-purple-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
  "bg-yellow-100 text-yellow-700",
];

function getTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return tagColors[Math.abs(hash) % tagColors.length];
}

const channelIcons: Record<string, React.ElementType> = {
  whatsapp: MessageCircle,
  email: Mail,
  phone: Phone,
};

const channelColors: Record<string, string> = {
  whatsapp: "text-green-600 bg-green-50",
  email: "text-blue-600 bg-blue-50",
  phone: "text-purple-600 bg-purple-50",
};

// ---------- Main Page ----------

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [importCsvText, setImportCsvText] = useState("");
  const [importCsvName, setImportCsvName] = useState("");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<CustomerImportMapping>({});
  const [lookupMatches, setLookupMatches] = useState<CompanyLookupMatch[]>([]);
  const [lookupMessage, setLookupMessage] = useState("");
  const [acceptingCompany, setAcceptingCompany] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [blockedFilter, setBlockedFilter] = useState(false);

  // Detail panel
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerData | null>(
    null
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    companyName: "",
    businessType: "",
    companyAddress: "",
    website: "",
    email: "",
    phone: "",
    whatsapp: "",
    tags: "",
  });

  // Notes
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Add customer modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    companyName: "",
    businessType: "",
    companyAddress: "",
    website: "",
    email: "",
    phone: "",
    whatsapp: "",
    tags: "",
  });
  const [addLoading, setAddLoading] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState<"notes" | "conversations">(
    "notes"
  );

  // ---------- Fetch ----------

  const fetchCustomers = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "20");
        if (searchQuery.trim()) params.set("search", searchQuery.trim());
        if (blockedFilter) params.set("isBlocked", "true");

        const res = await fetch(`/api/customers?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setCustomers(data.data);
          setPagination(data.pagination);
        }
      } catch (error) {
        console.error("Failed to fetch customers:", error);
      } finally {
        setLoading(false);
      }
    },
    [searchQuery, blockedFilter]
  );

  const fetchCustomerDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/customers/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedCustomer(data);
        setEditForm({
          name: data.name,
          companyName: data.companyName || "",
          businessType: data.businessType || "",
          companyAddress: data.companyAddress || "",
          website: data.website || "",
          email: data.email,
          phone: data.phone,
          whatsapp: data.whatsapp,
          tags: data.tags,
        });
      }
    } catch (error) {
      console.error("Failed to fetch customer detail:", error);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("customer");
    if (id) fetchCustomerDetail(id);
  }, [fetchCustomerDetail]);

  // ---------- Actions ----------

  const handleSelectCustomer = (customer: CustomerData) => {
    fetchCustomerDetail(customer.id);
    setEditMode(false);
    setNewNote("");
    setDetailTab("notes");
  };

  const handleCloseDetail = () => {
    setSelectedCustomer(null);
    setEditMode(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedCustomer) return;
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditMode(false);
        fetchCustomerDetail(selectedCustomer.id);
        fetchCustomers(pagination.page);
      }
    } catch (error) {
      console.error("Failed to update customer:", error);
    }
  };

  const handleToggleBlock = async () => {
    if (!selectedCustomer) return;
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBlocked: !selectedCustomer.isBlocked }),
      });
      if (res.ok) {
        fetchCustomerDetail(selectedCustomer.id);
        fetchCustomers(pagination.page);
      }
    } catch (error) {
      console.error("Failed to toggle block:", error);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer?")) return;
    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedCustomer?.id === id) setSelectedCustomer(null);
        fetchCustomers(pagination.page);
      }
    } catch (error) {
      console.error("Failed to delete customer:", error);
    }
  };

  const handleAddNote = async () => {
    if (!selectedCustomer || !newNote.trim() || addingNote) return;
    setAddingNote(true);
    try {
      const res = await fetch(
        `/api/customers/${selectedCustomer.id}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newNote.trim() }),
        }
      );
      if (res.ok) {
        setNewNote("");
        fetchCustomerDetail(selectedCustomer.id);
      }
    } catch (error) {
      console.error("Failed to add note:", error);
    } finally {
      setAddingNote(false);
    }
  };

  const handleAddCustomer = async () => {
    if (!addForm.name.trim() || addLoading) return;
    setAddLoading(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        setShowAddModal(false);
        setAddForm({ name: "", companyName: "", businessType: "", companyAddress: "", website: "", email: "", phone: "", whatsapp: "", tags: "" });
        fetchCustomers();
      }
    } catch (error) {
      console.error("Failed to add customer:", error);
    } finally {
      setAddLoading(false);
    }
  };

  const handleSelectImportFile = async (file?: File) => {
    if (!file) return;
    setImportMessage(""); setImportError("");
    setImportCsvText(""); setImportCsvName(""); setImportHeaders([]); setImportMapping({});
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("CSV files must be 10 MB or smaller.");
      const text = await file.text();
      const headers = getCustomerImportCsvHeaders(text);
      const normalizedHeaders = headers.map(header => header.trim().toLowerCase());
      const findHeader = (...aliases: string[]) => headers[normalizedHeaders.findIndex(header => aliases.includes(header))] || "";
      setImportCsvText(text);
      setImportCsvName(file.name);
      setImportHeaders(headers);
      setImportMapping({
        name: findHeader("name", "customer", "contact name", "full name"),
        companyName: findHeader("companyname", "company name", "company", "business name", "cégnév"),
        businessType: findHeader("businesstype", "business type", "industry", "sector", "üzleti típus", "tevékenység"),
        companyAddress: findHeader("companyaddress", "company address", "company headquarters", "headquarters", "address", "székhely", "cég székhelye"),
        website: findHeader("website", "web site", "url", "weboldal"),
        email: findHeader("email", "e-mail", "email address"),
        phone: findHeader("phone", "telephone", "mobile", "telefon"),
        whatsapp: findHeader("whatsapp", "whatsapp number", "wa"),
        tags: findHeader("tags", "labels", "címkék"),
      });
    } catch (error) { setImportError(error instanceof Error ? error.message : "The CSV could not be read."); }
  };

  const handleImportCustomers = async () => {
    if (!importCsvText || importing) return;
    setImporting(true); setImportMessage(""); setImportError("");
    try {
      const contacts = parseCustomerImportCsv(importCsvText, importMapping);
      const totals = { imported: 0, created: 0, updated: 0, duplicates: 0, customerIds: [] as string[] };
      const batchSize = 250;
      for (let start = 0; start < contacts.length; start += batchSize) {
        const batch = contacts.slice(start, start + batchSize);
        const response = await fetch("/api/customers/import", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: batch }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `The contact import failed at row ${start + 1}.`);
        totals.imported += result.imported || 0;
        totals.created += result.created || 0;
        totals.updated += result.updated || 0;
        totals.duplicates += result.duplicates || 0;
        if (Array.isArray(result.customerIds)) totals.customerIds.push(...result.customerIds);
        setImportMessage(`Imported ${Math.min(start + batch.length, contacts.length)} of ${contacts.length} contacts…`);
      }
      setImportMessage(`${totals.imported} contacts imported: ${totals.created} new, ${totals.updated} updated, ${totals.duplicates} duplicate rows skipped.`);
      setLookupMatches([]); setLookupMessage("");
      if (totals.customerIds.length) {
        setLookupMessage("Searching public company phone listings…");
        const lookupTotals = { searched: 0, matched: 0, matches: [] as CompanyLookupMatch[] };
        let lookupFailed = false;
        try {
          for (let start = 0; start < totals.customerIds.length; start += batchSize) {
            const lookupResponse = await fetch("/api/customers/import/lookup", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerIds: totals.customerIds.slice(start, start + batchSize) }),
            });
            const lookupResult = await lookupResponse.json();
            if (!lookupResponse.ok) { lookupFailed = true; break; }
            lookupTotals.searched += lookupResult.searched || 0;
            lookupTotals.matched += lookupResult.matched || 0;
            if (Array.isArray(lookupResult.matches)) lookupTotals.matches.push(...lookupResult.matches);
          }
        } catch { lookupFailed = true; }
        if (lookupFailed) {
          setLookupMessage("The public company search is temporarily unavailable. Your contacts were imported successfully; you can look up names from their profiles.");
        } else {
          setLookupMatches(lookupTotals.matches);
          setLookupMessage(lookupTotals.matched
            ? `Found public company matches for ${lookupTotals.matched} of ${lookupTotals.searched} phone numbers. Review and approve each name below.`
            : `No exact public company phone matches found for ${lookupTotals.searched} numbers. The contacts were imported; you can still check them individually from their profiles.`);
        }
      }
      await fetchCustomers(1);
      setImportCsvText(""); setImportCsvName(""); setImportHeaders([]); setImportMapping({});
      setShowImportModal(false);
    } catch (error) { setImportError(error instanceof Error ? error.message : "The CSV could not be read."); }
    finally { setImporting(false); }
  };

  const acceptCompanyLookup = async (match: CompanyLookupMatch, candidate: CompanyLookupMatch["candidates"][number]) => {
    setAcceptingCompany(match.customerId); setImportError("");
    try {
      const response = await fetch(`/api/customers/${match.customerId}/company-name`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", token: candidate.token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The company name could not be saved.");
      setLookupMatches(current => current.filter(item => item.customerId !== match.customerId));
      setLookupMessage(`${candidate.name} saved for ${match.phone}. Source: Wikidata.`);
      await fetchCustomers(1);
      if (selectedCustomer?.id === match.customerId) await fetchCustomerDetail(match.customerId);
    } catch (error) { setImportError(error instanceof Error ? error.message : "The company name could not be saved."); }
    finally { setAcceptingCompany(""); }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!selectedCustomer) return;
    const currentTags = editForm.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const newTags = currentTags.filter((t) => t !== tagToRemove);
    setEditForm({ ...editForm, tags: newTags.join(", ") });
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const input = e.currentTarget;
    const value = input.value.trim();
    if (!value) return;
    const currentTags = editForm.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!currentTags.includes(value)) {
      currentTags.push(value);
      setEditForm({ ...editForm, tags: currentTags.join(", ") });
    }
    input.value = "";
  };

  // ---------- Render helpers ----------

  const renderTags = (tagsStr: string) => {
    const tags = tagsStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "px-2 py-0.5 rounded-full text-xs font-medium",
              getTagColor(tag)
            )}
          >
            {tag}
          </span>
        ))}
      </div>
    );
  };

  return (
    <>
      <Header
        title="Customers"
        description="Manage your customer profiles and history"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setImportMessage(""); setImportError(""); setShowImportModal(true); }}
              className="flex items-center gap-2 px-4 py-2 border border-owly-border text-owly-text rounded-lg hover:bg-owly-primary-50 transition-colors text-sm font-medium"
            >
              <Upload className="h-4 w-4" />
              Import Contacts
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-owly-primary text-white rounded-lg hover:bg-owly-primary-dark transition-colors text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Customer
            </button>
          </div>
        }
      />

      {!showAddModal && !showImportModal && (importMessage || importError || lookupMessage) && <div className="px-6 py-2 space-y-1 text-sm">{importMessage && <p role="status" className="text-green-700">{importMessage}</p>}{lookupMessage && <p role="status" className="text-owly-text-light">{lookupMessage}</p>}{importError && <p role="alert" className="text-red-700">{importError}</p>}</div>}
      {lookupMatches.length > 0 && <section className="px-6 py-3 border-b border-owly-border bg-owly-surface space-y-2"><h2 className="text-sm font-semibold">Public company name matches</h2><p className="text-xs text-owly-text-light">Owly only searched exact phone matches in Wikidata&apos;s public company records. Review the source before approving; no private-person names are inferred.</p>{lookupMatches.flatMap(match => match.candidates.map(candidate => <div key={`${match.customerId}-${candidate.sourceUrl}`} className="flex flex-wrap items-center gap-2 border-t border-owly-border py-2 text-sm"><span className="font-medium">{match.phone} → {candidate.name}</span><a className="underline text-owly-text-light" href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a><button type="button" disabled={!!acceptingCompany} className="rounded-lg border border-owly-border px-3 py-1 disabled:opacity-50" onClick={() => void acceptCompanyLookup(match, candidate)}>{acceptingCompany === match.customerId ? "Saving…" : "Approve name"}</button></div>))}</section>}

      <div className="flex-1 flex overflow-hidden">
        {/* Main content */}
        <div
          className={cn(
            "flex-1 flex flex-col overflow-hidden",
            selectedCustomer && "hidden lg:flex"
          )}
        >
          {/* Search & Filters */}
          <div className="px-6 py-4 bg-owly-surface border-b border-owly-border">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-owly-text-light" />
                <input
                  type="text"
                  placeholder="Search by name, email, or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
                />
              </div>
              <button
                onClick={() => setBlockedFilter(!blockedFilter)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors",
                  blockedFilter
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "border-owly-border text-owly-text-light hover:bg-owly-primary-50"
                )}
              >
                <ShieldAlert className="h-4 w-4" />
                Blocked
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-sm text-owly-text-light">Loading...</div>
              </div>
            ) : customers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
                <div className="p-4 rounded-full bg-owly-primary-50 mb-4">
                  <Contact className="h-8 w-8 text-owly-primary" />
                </div>
                <p className="font-medium text-owly-text">
                  No customers found
                </p>
                <p className="text-sm text-owly-text-light mt-1">
                  {searchQuery || blockedFilter
                    ? "Try adjusting your search or filters"
                    : "Add your first customer to get started"}
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-owly-border bg-owly-surface/50">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider">
                      Name
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider hidden md:table-cell">
                      Email
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider hidden lg:table-cell">
                      Phone
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider hidden xl:table-cell">
                      Tags
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider hidden lg:table-cell">
                      First Contact
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider hidden md:table-cell">
                      Last Contact
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-owly-text-light uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-owly-border">
                  {customers.map((customer) => (
                    <tr
                      key={customer.id}
                      onClick={() => handleSelectCustomer(customer)}
                      className={cn(
                        "hover:bg-owly-primary-50/50 cursor-pointer transition-colors",
                        selectedCustomer?.id === customer.id &&
                          "bg-owly-primary-50"
                      )}
                    >
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-owly-primary-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-medium text-owly-primary">
                              {customer.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-owly-text truncate">
                            {customer.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-sm text-owly-text-light truncate">
                          {customer.email || "--"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm text-owly-text-light">
                          {customer.phone || "--"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        {renderTags(customer.tags) || (
                          <span className="text-sm text-owly-text-light">
                            --
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-owly-text-light">
                          {formatDate(customer.firstContact)}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-owly-text-light">
                          {formatDate(customer.lastContact)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {customer.isBlocked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            <ShieldAlert className="h-3 w-3" />
                            Blocked
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCustomer(customer.id);
                          }}
                          className="p-1.5 text-owly-text-light hover:text-owly-danger hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete customer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 bg-owly-surface border-t border-owly-border">
              <span className="text-sm text-owly-text-light">
                Showing{" "}
                {Math.min(
                  (pagination.page - 1) * pagination.limit + 1,
                  pagination.total
                )}{" "}
                to{" "}
                {Math.min(
                  pagination.page * pagination.limit,
                  pagination.total
                )}{" "}
                of {pagination.total} customers
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fetchCustomers(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    pagination.page <= 1
                      ? "text-owly-text-light/40 cursor-not-allowed"
                      : "text-owly-text-light hover:bg-owly-primary-50 hover:text-owly-primary"
                  )}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from(
                  { length: Math.min(pagination.totalPages, 5) },
                  (_, i) => {
                    let pageNum: number;
                    if (pagination.totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (pagination.page <= 3) {
                      pageNum = i + 1;
                    } else if (
                      pagination.page >= pagination.totalPages - 2
                    ) {
                      pageNum = pagination.totalPages - 4 + i;
                    } else {
                      pageNum = pagination.page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => fetchCustomers(pageNum)}
                        className={cn(
                          "w-8 h-8 text-sm rounded-lg transition-colors",
                          pageNum === pagination.page
                            ? "bg-owly-primary text-white"
                            : "text-owly-text-light hover:bg-owly-primary-50 hover:text-owly-primary"
                        )}
                      >
                        {pageNum}
                      </button>
                    );
                  }
                )}
                <button
                  onClick={() => fetchCustomers(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    pagination.page >= pagination.totalPages
                      ? "text-owly-text-light/40 cursor-not-allowed"
                      : "text-owly-text-light hover:bg-owly-primary-50 hover:text-owly-primary"
                  )}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedCustomer && (
          <div className="w-full lg:w-[480px] xl:w-[540px] border-l border-owly-border bg-owly-surface flex flex-col overflow-hidden">
            {/* Detail Header */}
            <div className="px-4 py-3 border-b border-owly-border flex items-center gap-3">
              <button
                onClick={handleCloseDetail}
                className="lg:hidden p-1.5 hover:bg-owly-primary-50 rounded-lg transition-colors"
              >
                <ChevronLeft className="h-5 w-5 text-owly-text" />
              </button>
              <div className="w-10 h-10 rounded-full bg-owly-primary-100 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-semibold text-owly-primary">
                  {selectedCustomer.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                {editMode ? (
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    className="text-sm font-semibold text-owly-text bg-owly-bg border border-owly-border rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-owly-primary/30"
                  />
                ) : (
                  <h3 className="font-semibold text-owly-text truncate">
                    {selectedCustomer.name}
                  </h3>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedCustomer.isBlocked && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                      <ShieldAlert className="h-3 w-3" />
                      Blocked
                    </span>
                  )}
                  <span className="text-xs text-owly-text-light">
                    {selectedCustomer._count?.notes ?? selectedCustomer.notes?.length ?? 0} notes
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {editMode ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      className="px-3 py-1.5 text-xs font-medium bg-owly-primary text-white rounded-lg hover:bg-owly-primary-dark transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditMode(false);
                        setEditForm({
                          name: selectedCustomer.name,
                          companyName: selectedCustomer.companyName || "",
                          businessType: selectedCustomer.businessType || "",
                          companyAddress: selectedCustomer.companyAddress || "",
                          website: selectedCustomer.website || "",
                          email: selectedCustomer.email,
                          phone: selectedCustomer.phone,
                          whatsapp: selectedCustomer.whatsapp,
                          tags: selectedCustomer.tags,
                        });
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-owly-text-light border border-owly-border rounded-lg hover:bg-owly-primary-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setEditMode(true)}
                      className="p-1.5 text-owly-text-light hover:text-owly-primary hover:bg-owly-primary-50 rounded-lg transition-colors"
                      title="Edit customer"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleToggleBlock}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        selectedCustomer.isBlocked
                          ? "text-green-600 hover:bg-green-50"
                          : "text-owly-text-light hover:text-red-600 hover:bg-red-50"
                      )}
                      title={
                        selectedCustomer.isBlocked
                          ? "Unblock customer"
                          : "Block customer"
                      }
                    >
                      {selectedCustomer.isBlocked ? (
                        <ShieldOff className="h-4 w-4" />
                      ) : (
                        <ShieldAlert className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={handleCloseDetail}
                      className="hidden lg:block p-1.5 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {detailLoading && !selectedCustomer?.notes ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-sm text-owly-text-light">Loading...</div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {/* Contact Info */}
                <div className="px-4 py-3 border-b border-owly-border space-y-2">
                  {editMode ? (
                    <div className="space-y-2">
                      <div><label className="text-xs text-owly-text-light font-medium">Company name</label><input type="text" value={editForm.companyName} onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })} className="w-full mt-0.5 text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30" placeholder="Company name" /></div>
                      <div><label className="text-xs text-owly-text-light font-medium">Business type</label><input type="text" value={editForm.businessType} onChange={(e) => setEditForm({ ...editForm, businessType: e.target.value })} className="w-full mt-0.5 text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30" placeholder="Business type" /></div>
                      <div><label className="text-xs text-owly-text-light font-medium">Company headquarters</label><input type="text" value={editForm.companyAddress} onChange={(e) => setEditForm({ ...editForm, companyAddress: e.target.value })} className="w-full mt-0.5 text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30" placeholder="Company address" /></div>
                      <div><label className="text-xs text-owly-text-light font-medium">Website</label><input type="url" value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} className="w-full mt-0.5 text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30" placeholder="https://example.com" /></div>
                      <div>
                        <label className="text-xs text-owly-text-light font-medium">
                          Email
                        </label>
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={(e) =>
                            setEditForm({ ...editForm, email: e.target.value })
                          }
                          className="w-full mt-0.5 text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30"
                          placeholder="Email address"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-owly-text-light font-medium">
                          Phone
                        </label>
                        <input
                          type="tel"
                          value={editForm.phone}
                          onChange={(e) =>
                            setEditForm({ ...editForm, phone: e.target.value })
                          }
                          className="w-full mt-0.5 text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30"
                          placeholder="Phone number"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-owly-text-light font-medium">
                          WhatsApp
                        </label>
                        <input
                          type="tel"
                          value={editForm.whatsapp}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              whatsapp: e.target.value,
                            })
                          }
                          className="w-full mt-0.5 text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30"
                          placeholder="WhatsApp number"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {selectedCustomer.companyName && <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" /><span className="text-sm text-owly-text truncate">{selectedCustomer.companyName}</span></div>}
                      {selectedCustomer.businessType && <div className="flex items-center gap-2"><Contact className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" /><span className="text-sm text-owly-text truncate">{selectedCustomer.businessType}</span></div>}
                      {selectedCustomer.companyAddress && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" /><span className="text-sm text-owly-text truncate" title={selectedCustomer.companyAddress}>{selectedCustomer.companyAddress}</span></div>}
                      {selectedCustomer.website && <div className="flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" /><a className="text-sm text-owly-primary underline truncate" href={selectedCustomer.website} target="_blank" rel="noopener noreferrer">{selectedCustomer.website}</a></div>}
                      {selectedCustomer.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" />
                          <span className="text-sm text-owly-text truncate">
                            {selectedCustomer.email}
                          </span>
                        </div>
                      )}
                      {selectedCustomer.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" />
                          <span className="text-sm text-owly-text">
                            {selectedCustomer.phone}
                          </span>
                        </div>
                      )}
                      {selectedCustomer.whatsapp && (
                        <div className="flex items-center gap-2">
                          <MessageCircle className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" />
                          <span className="text-sm text-owly-text">
                            {selectedCustomer.whatsapp}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-owly-text-light flex-shrink-0" />
                        <span className="text-xs text-owly-text-light">
                          Since {formatDate(selectedCustomer.firstContact)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Tags */}
                {!editMode && (selectedCustomer.phone || selectedCustomer.whatsapp) && <div className="px-4 py-3 border-b border-owly-border"><CompanyNameLookup key={selectedCustomer.id} customerId={selectedCustomer.id} onAccepted={() => { fetchCustomerDetail(selectedCustomer.id); fetchCustomers(pagination.page); }} /></div>}
                <div className="px-4 py-3 border-b border-owly-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-owly-text-light uppercase tracking-wider">
                      Tags
                    </span>
                  </div>
                  {editMode ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {editForm.tags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean)
                          .map((tag) => (
                            <span
                              key={tag}
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                                getTagColor(tag)
                              )}
                            >
                              {tag}
                              <button
                                onClick={() => handleRemoveTag(tag)}
                                className="hover:opacity-70"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Type a tag and press Enter..."
                        onKeyDown={handleAddTag}
                        className="w-full text-sm bg-owly-bg border border-owly-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-owly-primary/30"
                      />
                    </div>
                  ) : (
                    renderTags(selectedCustomer.tags) || (
                      <span className="text-sm text-owly-text-light">
                        No tags
                      </span>
                    )
                  )}
                </div>

                {/* Tabs */}
                <div className="flex border-b border-owly-border">
                  <button
                    onClick={() => setDetailTab("notes")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
                      detailTab === "notes"
                        ? "text-owly-primary border-b-2 border-owly-primary"
                        : "text-owly-text-light hover:text-owly-text"
                    )}
                  >
                    <StickyNote className="h-4 w-4" />
                    Notes
                  </button>
                  <button
                    onClick={() => setDetailTab("conversations")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
                      detailTab === "conversations"
                        ? "text-owly-primary border-b-2 border-owly-primary"
                        : "text-owly-text-light hover:text-owly-text"
                    )}
                  >
                    <MessageSquare className="h-4 w-4" />
                    Conversations
                  </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1">
                  {detailTab === "notes" ? (
                    <div className="p-4 space-y-3">
                      {/* Add Note */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Add a note..."
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddNote();
                          }}
                          className="flex-1 text-sm bg-owly-bg border border-owly-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
                        />
                        <button
                          onClick={handleAddNote}
                          disabled={!newNote.trim() || addingNote}
                          className={cn(
                            "p-2 rounded-lg transition-colors",
                            newNote.trim() && !addingNote
                              ? "bg-owly-primary text-white hover:bg-owly-primary-dark"
                              : "bg-owly-border text-owly-text-light cursor-not-allowed"
                          )}
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Notes Timeline */}
                      {selectedCustomer.notes.length === 0 ? (
                        <div className="text-center py-8">
                          <StickyNote className="h-8 w-8 text-owly-text-light/40 mx-auto mb-2" />
                          <p className="text-sm text-owly-text-light">
                            No notes yet
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedCustomer.notes.map((note) => (
                            <div
                              key={note.id}
                              className="bg-owly-bg border border-owly-border rounded-lg p-3"
                            >
                              <p className="text-sm text-owly-text whitespace-pre-wrap">
                                {note.content}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                <User className="h-3 w-3 text-owly-text-light" />
                                <span className="text-xs text-owly-text-light">
                                  {note.authorName}
                                </span>
                                <span className="text-xs text-owly-text-light">
                                  --
                                </span>
                                <span className="text-xs text-owly-text-light">
                                  {formatDate(note.createdAt)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4">
                      {!selectedCustomer.conversations ||
                      selectedCustomer.conversations.length === 0 ? (
                        <div className="text-center py-8">
                          <MessageSquare className="h-8 w-8 text-owly-text-light/40 mx-auto mb-2" />
                          <p className="text-sm text-owly-text-light">
                            No conversations found
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {selectedCustomer.conversations.map((conv) => {
                            const ChannelIcon =
                              channelIcons[conv.channel] || MessageSquare;
                            return (
                              <div
                                key={conv.id}
                                className="flex items-center gap-3 bg-owly-bg border border-owly-border rounded-lg p-3 hover:border-owly-primary/30 transition-colors"
                              >
                                <div
                                  className={cn(
                                    "p-2 rounded-lg flex-shrink-0",
                                    channelColors[conv.channel] ||
                                      "text-owly-primary bg-owly-primary-50"
                                  )}
                                >
                                  <ChannelIcon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-owly-text">
                                      {getChannelLabel(conv.channel)}
                                    </span>
                                    <span
                                      className={cn(
                                        "px-2 py-0.5 rounded-full text-xs font-medium",
                                        getStatusColor(conv.status)
                                      )}
                                    >
                                      {conv.status}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-owly-text-light">
                                      {formatDate(conv.createdAt)}
                                    </span>
                                    <span className="text-xs text-owly-text-light">
                                      --
                                    </span>
                                    <span className="text-xs text-owly-text-light">
                                      {conv._count.messages} messages
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      <Modal open={showImportModal} onClose={() => !importing && setShowImportModal(false)} title="Import customers" size="lg" className="max-h-[90vh] overflow-y-auto">
        <div className="space-y-4">
          <p className="text-sm text-owly-text-light">Upload a CSV contact list. You can map any source column to Owly fields. Up to 15,000 contacts can be imported in safe batches.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className={cn("inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-owly-border text-sm font-medium cursor-pointer hover:bg-owly-primary-50", importing && "opacity-50 pointer-events-none")}>
              <Upload className="h-4 w-4" />{importing ? "Importing…" : "Choose CSV file"}
              <input className="sr-only" type="file" accept=".csv,text/csv" disabled={importing} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void handleSelectImportFile(file); }} />
            </label>
            <a href="/owly-customer-import-template.csv" download className="text-sm underline text-owly-text-light">Download CSV template</a>
          </div>
          {importCsvName && !importCsvText && <p className="text-sm text-owly-text-light">Reading {importCsvName}…</p>}
          {importCsvText && <div className="rounded-lg border border-owly-border p-3 space-y-3">
            <p className="text-sm font-medium text-owly-text">Match CSV columns · {importCsvName}</p>
            <p className="text-xs text-owly-text-light">Choose which source column contains each Owly field. At least one of email, phone, or WhatsApp must be mapped.</p>
            {([
              ["name", "Customer name"], ["companyName", "Company name"], ["businessType", "Business type"], ["companyAddress", "Company headquarters"], ["website", "Website"], ["email", "Email"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["tags", "Tags"],
            ] as [CustomerImportField, string][]).map(([field, label]) => <label key={field} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 text-sm">
              <span className="text-owly-text">{label}</span>
              <select value={importMapping[field] || ""} disabled={importing} onChange={event => setImportMapping(current => ({ ...current, [field]: event.target.value }))} className="min-w-0 rounded border border-owly-border bg-owly-bg px-2 py-1.5 text-sm">
                <option value="">Skip this field</option>
                {importHeaders.map((header, index) => <option key={`${header}-${index}`} value={header}>{header}</option>)}
              </select>
            </label>)}
            <p className="text-xs text-owly-text-light">15,000 contact maximum · 10 MB CSV maximum · Existing contacts are matched and updated.</p>
            <button type="button" onClick={() => void handleImportCustomers()} disabled={importing} className="rounded-lg bg-owly-primary px-3 py-2 text-sm font-medium text-white hover:bg-owly-primary-dark disabled:opacity-50">{importing ? "Importing…" : "Import mapped contacts"}</button>
          </div>}
          {importing && <p role="status" className="text-sm text-owly-text-light">{importMessage || "Importing contacts…"}</p>}
          {importMessage && !importing && <p role="status" className="text-sm text-green-700">{importMessage}</p>}
          {lookupMessage && <p role="status" className="text-sm text-owly-text-light">{lookupMessage}</p>}
          {lookupMatches.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold">Public company name matches</h3><p className="text-xs text-owly-text-light">Review the public source before approving any name.</p>{lookupMatches.map(match => match.candidates.map(candidate => <div key={`${match.customerId}-${candidate.sourceUrl}`} className="flex flex-wrap items-center gap-2 border-t border-owly-border py-2 text-sm"><span className="font-medium">{match.phone} → {candidate.name}</span><a className="underline text-owly-text-light" href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a><button type="button" disabled={!!acceptingCompany} className="rounded-lg border border-owly-border px-3 py-1 disabled:opacity-50" onClick={() => void acceptCompanyLookup(match, candidate)}>{acceptingCompany === match.customerId ? "Saving…" : "Approve name"}</button></div>))}</section>}
          {importError && <p role="alert" className="text-sm text-red-700">{importError}</p>}
        </div>
      </Modal>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowAddModal(false)}
          />
          <div className="relative bg-owly-surface rounded-xl shadow-xl border border-owly-border w-full max-w-md max-h-[90vh] mx-4 flex flex-col animate-scale-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-owly-border">
              <h3 className="text-lg font-semibold text-owly-text">
                Add Customer
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) =>
                    setAddForm({ ...addForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
                  placeholder="Customer name"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">Company name</label>
                <input type="text" value={addForm.companyName} onChange={(e) => setAddForm({ ...addForm, companyName: e.target.value })} className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary" placeholder="Company name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">Business type</label>
                <input type="text" value={addForm.businessType} onChange={(e) => setAddForm({ ...addForm, businessType: e.target.value })} className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary" placeholder="e.g. Restaurant, Agency" />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">Company headquarters</label>
                <input type="text" value={addForm.companyAddress} onChange={(e) => setAddForm({ ...addForm, companyAddress: e.target.value })} className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary" placeholder="Company address" />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">Website</label>
                <input type="url" value={addForm.website} onChange={(e) => setAddForm({ ...addForm, website: e.target.value })} className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary" placeholder="https://example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) =>
                    setAddForm({ ...addForm, email: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
                  placeholder="Email address"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={addForm.phone}
                  onChange={(e) =>
                    setAddForm({ ...addForm, phone: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
                  placeholder="Phone number"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">
                  WhatsApp
                </label>
                <input
                  type="tel"
                  value={addForm.whatsapp}
                  onChange={(e) =>
                    setAddForm({ ...addForm, whatsapp: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
                  placeholder="WhatsApp number"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-owly-text mb-1">
                  Tags
                </label>
                <input
                  type="text"
                  value={addForm.tags}
                  onChange={(e) =>
                    setAddForm({ ...addForm, tags: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-owly-border rounded-lg bg-owly-bg focus:outline-none focus:ring-2 focus:ring-owly-primary/30 focus:border-owly-primary"
                  placeholder="Comma-separated tags (e.g. VIP, Premium)"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-owly-border">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm font-medium text-owly-text-light border border-owly-border rounded-lg hover:bg-owly-primary-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustomer}
                disabled={!addForm.name.trim() || addLoading}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  addForm.name.trim() && !addLoading
                    ? "bg-owly-primary text-white hover:bg-owly-primary-dark"
                    : "bg-owly-border text-owly-text-light cursor-not-allowed"
                )}
              >
                {addLoading ? "Adding..." : "Add Customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
