export interface McpCompatibilityContract {
    version: string;
    protocol: 'mcp';
    gateway: {
        mode: 'dual_stack';
        legacy_prefix: string;
        next_prefix: string;
    };
    list_tools: {
        must_include_prefixes: [string, string];
        required_legacy_tools: string[];
        required_cognitive_core_tools: string[];
    };
    call_tool: {
        accepted_name_fields: string[];
        accepted_args_fields: string[];
        error_mode: 'structured_mcp_error';
    };
    rollout: {
        canary_schedule: number[];
        rollback_required: boolean;
        shadow_mode_required: boolean;
    };
}

export const MCP_COMPATIBILITY_CONTRACT: McpCompatibilityContract = {
    version: '2026-02-20',
    protocol: 'mcp',
    gateway: {
        mode: 'dual_stack',
        legacy_prefix: 'eidolon_',
        next_prefix: 'clawkit_',
    },
    list_tools: {
        must_include_prefixes: ['eidolon_', 'clawkit_'],
        required_legacy_tools: [
            'eidolon_oracle_sense',
            'eidolon_defi_quote',
            'eidolon_security_scan',
            'eidolon_get_portfolio',
            'eidolon_execute_swap',
            'eidolon_panic_button',
            'eidolon_recall',
            'eidolon_intuition',
            'eidolon_dream',
        ],
        required_cognitive_core_tools: [
            'clawkit_recall_user',
            'clawkit_sense_intent',
            'clawkit_reason_chain',
            'clawkit_memory_query',
            'clawkit_compress_context',
        ],
    },
    call_tool: {
        accepted_name_fields: ['name', 'tool'],
        accepted_args_fields: ['arguments', 'input'],
        error_mode: 'structured_mcp_error',
    },
    rollout: {
        canary_schedule: [5, 10, 25, 50, 100],
        rollback_required: true,
        shadow_mode_required: true,
    },
};
