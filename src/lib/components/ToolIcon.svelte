<script lang="ts">
  import {
    Terminal,
    FileText,
    Pencil,
    FilePlus,
    FolderSearch,
    Search,
    Bot,
    Globe,
    Wrench,
  } from 'lucide-svelte';

  interface Props {
    tool_name: string;
    size?: number;
  }

  let { tool_name, size = 12 }: Props = $props();

  const toolConfig: Record<string, { icon: typeof Terminal; colorClass: string }> = {
    // Canonical names
    shell: { icon: Terminal, colorClass: 'tool-green' },
    file_read: { icon: FileText, colorClass: 'tool-blue' },
    file_edit: { icon: Pencil, colorClass: 'tool-orange' },
    file_write: { icon: FilePlus, colorClass: 'tool-orange' },
    file_search: { icon: FolderSearch, colorClass: 'tool-purple' },
    content_search: { icon: Search, colorClass: 'tool-purple' },
    agent: { icon: Bot, colorClass: 'tool-cyan' },
    web_fetch: { icon: Globe, colorClass: 'tool-blue' },
    web_search: { icon: Globe, colorClass: 'tool-blue' },
    // Claude Code names (backwards compat)
    Bash: { icon: Terminal, colorClass: 'tool-green' },
    Read: { icon: FileText, colorClass: 'tool-blue' },
    Edit: { icon: Pencil, colorClass: 'tool-orange' },
    Write: { icon: FilePlus, colorClass: 'tool-orange' },
    Glob: { icon: FolderSearch, colorClass: 'tool-purple' },
    Grep: { icon: Search, colorClass: 'tool-purple' },
    Agent: { icon: Bot, colorClass: 'tool-cyan' },
  };

  let config = $derived(toolConfig[tool_name] ?? { icon: Wrench, colorClass: 'tool-gray' });
</script>

<span class="tool-icon {config.colorClass}">
  {#if config}
    {@const Icon = config.icon}
    <Icon {size} strokeWidth={2} />
  {/if}
</span>

<style>
  .tool-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .tool-green { color: var(--active); }
  .tool-blue { color: var(--active); }
  .tool-orange { color: var(--active); }
  .tool-purple { color: var(--active); }
  .tool-cyan { color: var(--active); }
  .tool-gray { color: var(--text-muted); }
</style>
