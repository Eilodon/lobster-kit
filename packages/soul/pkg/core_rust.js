/* @ts-self-types="./core_rust.d.ts" */

class AntiRug {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AntiRugFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_antirug_free(ptr, 0);
    }
    /**
     * @param {string} address
     */
    add_to_blacklist(address) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.antirug_add_to_blacklist(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} address
     */
    add_to_whitelist(address) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.antirug_add_to_whitelist(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} _token_address
     * @returns {any}
     */
    check_token_security(_token_address) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(_token_address, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.antirug_check_token_security(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     *
     *     * compute_score
     *     * Real logic: Takes raw API data and computes a rigorous safety score.
     *
     * @param {string} token_address
     * @param {any} data
     * @returns {any}
     */
    compute_score(token_address, data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(token_address, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.antirug_compute_score(retptr, this.__wbg_ptr, ptr0, len0, addHeapObject(data));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Export whitelist + blacklist as JSON for persistence
     * @returns {any}
     */
    export_lists() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.antirug_export_lists(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Import previously persisted whitelist + blacklist from JSON
     * @param {any} data
     */
    import_lists(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.antirug_import_lists(retptr, this.__wbg_ptr, addHeapObject(data));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    constructor() {
        const ret = wasm.antirug_new();
        this.__wbg_ptr = ret >>> 0;
        AntiRugFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) AntiRug.prototype[Symbol.dispose] = AntiRug.prototype.free;
exports.AntiRug = AntiRug;

class CausalGraph {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CausalGraphFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_causalgraph_free(ptr, 0);
    }
    /**
     * Export edges as JSON: { "CauseName->EffectName": { successes, failures, prob } }
     * @returns {any}
     */
    export_edges() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.causalgraph_export_edges(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {SentinelVariable} cause
     * @param {SentinelVariable} effect
     * @returns {number}
     */
    get_causal_effect(cause, effect) {
        const ret = wasm.causalgraph_get_causal_effect(this.__wbg_ptr, cause, effect);
        return ret;
    }
    /**
     * Get full edge details (successes/failures/prob) for UI/Adapter
     * @param {SentinelVariable} cause
     * @param {SentinelVariable} effect
     * @returns {any}
     */
    get_edge(cause, effect) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.causalgraph_get_edge(retptr, this.__wbg_ptr, cause, effect);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Import edges from JSON
     * @param {any} data
     */
    import_edges(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.causalgraph_import_edges(retptr, this.__wbg_ptr, addHeapObject(data));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {SentinelVariable} cause
     * @param {SentinelVariable} effect
     * @param {boolean} outcome_positive
     */
    learn(cause, effect, outcome_positive) {
        wasm.causalgraph_learn(this.__wbg_ptr, cause, effect, outcome_positive);
    }
    constructor() {
        const ret = wasm.causalgraph_new();
        this.__wbg_ptr = ret >>> 0;
        CausalGraphFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {SentinelVariable} param
     * @param {any} observations
     * @returns {number}
     */
    predict(param, observations) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.causalgraph_predict(retptr, this.__wbg_ptr, param, addHeapObject(observations));
            var r0 = getDataViewMemory0().getFloat32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) CausalGraph.prototype[Symbol.dispose] = CausalGraph.prototype.free;
exports.CausalGraph = CausalGraph;

class ConversationDomainConfig {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ConversationDomainConfig.prototype);
        obj.__wbg_ptr = ptr;
        ConversationDomainConfigFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ConversationDomainConfigFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_conversationdomainconfig_free(ptr, 0);
    }
    /**
     * @returns {ConversationDomainConfig}
     */
    static advisory() {
        const ret = wasm.conversationdomainconfig_advisory();
        return ConversationDomainConfig.__wrap(ret);
    }
    /**
     * @returns {ConversationDomainConfig}
     */
    static discovery() {
        const ret = wasm.conversationdomainconfig_discovery();
        return ConversationDomainConfig.__wrap(ret);
    }
    /**
     * @param {number} intrusiveness_threshold
     * @param {number} trust_decay_rate
     * @param {number} trauma_severity_scale
     * @param {number} dagma_trigger_episodes
     * @param {number} thermo_dt
     */
    constructor(intrusiveness_threshold, trust_decay_rate, trauma_severity_scale, dagma_trigger_episodes, thermo_dt) {
        const ret = wasm.conversationdomainconfig_new(intrusiveness_threshold, trust_decay_rate, trauma_severity_scale, dagma_trigger_episodes, thermo_dt);
        this.__wbg_ptr = ret >>> 0;
        ConversationDomainConfigFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {ConversationDomainConfig}
     */
    static peer() {
        const ret = wasm.conversationdomainconfig_peer();
        return ConversationDomainConfig.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    get dagma_trigger_episodes() {
        const ret = wasm.__wbg_get_conversationdomainconfig_dagma_trigger_episodes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get intrusiveness_threshold() {
        const ret = wasm.__wbg_get_conversationdomainconfig_intrusiveness_threshold(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get thermo_dt() {
        const ret = wasm.__wbg_get_conversationdomainconfig_thermo_dt(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get trauma_severity_scale() {
        const ret = wasm.__wbg_get_conversationdomainconfig_trauma_severity_scale(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get trust_decay_rate() {
        const ret = wasm.__wbg_get_conversationdomainconfig_trust_decay_rate(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set dagma_trigger_episodes(arg0) {
        wasm.__wbg_set_conversationdomainconfig_dagma_trigger_episodes(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set intrusiveness_threshold(arg0) {
        wasm.__wbg_set_conversationdomainconfig_intrusiveness_threshold(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set thermo_dt(arg0) {
        wasm.__wbg_set_conversationdomainconfig_thermo_dt(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set trauma_severity_scale(arg0) {
        wasm.__wbg_set_conversationdomainconfig_trauma_severity_scale(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set trust_decay_rate(arg0) {
        wasm.__wbg_set_conversationdomainconfig_trust_decay_rate(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) ConversationDomainConfig.prototype[Symbol.dispose] = ConversationDomainConfig.prototype.free;
exports.ConversationDomainConfig = ConversationDomainConfig;

class CounterfactualResult {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(CounterfactualResult.prototype);
        obj.__wbg_ptr = ptr;
        CounterfactualResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CounterfactualResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_counterfactualresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get actual_prob() {
        const ret = wasm.__wbg_get_conversationdomainconfig_intrusiveness_threshold(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get delta() {
        const ret = wasm.__wbg_get_conversationdomainconfig_trauma_severity_scale(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get hypothetical_prob() {
        const ret = wasm.__wbg_get_conversationdomainconfig_trust_decay_rate(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get would_have_been_better() {
        const ret = wasm.__wbg_get_counterfactualresult_would_have_been_better(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} arg0
     */
    set actual_prob(arg0) {
        wasm.__wbg_set_conversationdomainconfig_intrusiveness_threshold(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set delta(arg0) {
        wasm.__wbg_set_conversationdomainconfig_trauma_severity_scale(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set hypothetical_prob(arg0) {
        wasm.__wbg_set_conversationdomainconfig_trust_decay_rate(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set would_have_been_better(arg0) {
        wasm.__wbg_set_counterfactualresult_would_have_been_better(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) CounterfactualResult.prototype[Symbol.dispose] = CounterfactualResult.prototype.free;
exports.CounterfactualResult = CounterfactualResult;

/**
 * Result of a matched trade
 */
class Fill {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FillFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fill_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get maker_id() {
        const ret = wasm.__wbg_get_fill_maker_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {bigint}
     */
    get price() {
        const ret = wasm.__wbg_get_fill_price(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {bigint}
     */
    get quantity() {
        const ret = wasm.__wbg_get_fill_quantity(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get taker_id() {
        const ret = wasm.__wbg_get_fill_taker_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set maker_id(arg0) {
        wasm.__wbg_set_fill_maker_id(this.__wbg_ptr, arg0);
    }
    /**
     * @param {bigint} arg0
     */
    set price(arg0) {
        wasm.__wbg_set_fill_price(this.__wbg_ptr, arg0);
    }
    /**
     * @param {bigint} arg0
     */
    set quantity(arg0) {
        wasm.__wbg_set_fill_quantity(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set taker_id(arg0) {
        wasm.__wbg_set_fill_taker_id(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Fill.prototype[Symbol.dispose] = Fill.prototype.free;
exports.Fill = Fill;

class HyperMemory {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HyperMemoryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_hypermemory_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    count() {
        const ret = wasm.hypermemory_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {any}
     */
    export_data() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.hypermemory_export_data(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {any} data
     */
    import_data(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.hypermemory_import_data(retptr, this.__wbg_ptr, addHeapObject(data));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} id
     * @param {Float32Array} vector
     */
    insert(id, vector) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArrayF32ToWasm0(vector, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            wasm.hypermemory_insert(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} dimension
     */
    constructor(dimension) {
        const ret = wasm.hypermemory_new(dimension);
        this.__wbg_ptr = ret >>> 0;
        HyperMemoryFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Float32Array} query_vector
     * @param {number} k
     * @returns {any}
     */
    search(query_vector, k) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF32ToWasm0(query_vector, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.hypermemory_search(retptr, this.__wbg_ptr, ptr0, len0, k);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) HyperMemory.prototype[Symbol.dispose] = HyperMemory.prototype.free;
exports.HyperMemory = HyperMemory;

class Intervenable {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IntervenableFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_intervenable_free(ptr, 0);
    }
    /**
     * Counterfactual: "What WOULD have happened if I chose differently?"
     * actual_var: "I chose AdvisorMode (Observation)"
     * hypothetical_var: "I chose PeerMode (Intervention)"
     * query_var: "OutcomeQuality"
     * @param {CausalGraph} graph
     * @param {SentinelVariable} actual_var
     * @param {SentinelVariable} hypothetical_var
     * @param {SentinelVariable} query_var
     * @returns {CounterfactualResult}
     */
    counterfactual(graph, actual_var, hypothetical_var, query_var) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(graph, CausalGraph);
            wasm.intervenable_counterfactual(retptr, this.__wbg_ptr, graph.__wbg_ptr, actual_var, hypothetical_var, query_var);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return CounterfactualResult.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Pearl's do-calculus: P(Y | do(X=x))
     * Cut all incoming edges to X, set X=x, propagate forward.
     * Simplified implementation for the DAG:
     * Since our predict() is a linear combination, observing X=1 is similar to do(X=1) IF we ignore back-door paths (confounders).
     * In our simplified CausalGraph, we treat all parents as direct causes.
     * To strictly implement do(X), we need to ensure X's value is fixed regardless of its parents.
     *
     * However, our predict() function takes `observations` list. If X is in observations, it is effectively "clamped".
     * The difference between observation `P(Y|X)` and intervention `P(Y|do(X))` matters if X has parents that also affect Y (Confounders).
     *
     * For this version, we will perform "Mutilated Graph" intervention:
     * 1. Clone graph (conceptually - we just ignore incoming edges to X).
     * 2. But `predict` logic already sums over *provided* observations.
     *    If we provide X in observations, and we compute Y based on X, we are forward propagating.
     *    Does `predict` look at X's parents? `predict` logic:
     *    `weighted_sum += value * w` for each observed cause.
     *    It assumes observations are the *only* active causes or the *known* state of causes.
     *    It does NOT recursivley calculate unobserved causes.
     *    So in our specific implementation, `predict(Y, [X=x])` IS effectively `P(Y|do(X=x))` because we don't back-propagate to confounders.
     *
     * So we can wrap `predict` but with explicit semantic meaning.
     * @param {CausalGraph} graph
     * @param {SentinelVariable} intervention_var
     * @param {number} intervention_value
     * @param {SentinelVariable} query_var
     * @returns {number}
     */
    do_intervention(graph, intervention_var, intervention_value, query_var) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(graph, CausalGraph);
            wasm.intervenable_do_intervention(retptr, this.__wbg_ptr, graph.__wbg_ptr, intervention_var, intervention_value, query_var);
            var r0 = getDataViewMemory0().getFloat32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    constructor() {
        const ret = wasm.intervenable_new();
        this.__wbg_ptr = ret >>> 0;
        IntervenableFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Intervenable.prototype[Symbol.dispose] = Intervenable.prototype.free;
exports.Intervenable = Intervenable;

class LiquidBrain {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LiquidBrainFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_liquidbrain_free(ptr, 0);
    }
    /**
     * @param {Float32Array} input
     * @returns {Float32Array}
     */
    forward(input) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.liquidbrain_forward(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} input_size
     * @param {number} hidden_size
     */
    constructor(input_size, hidden_size) {
        const ret = wasm.liquidbrain_new(input_size, hidden_size);
        this.__wbg_ptr = ret >>> 0;
        LiquidBrainFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} reward_signal
     */
    optimize(reward_signal) {
        wasm.liquidbrain_optimize(this.__wbg_ptr, reward_signal);
    }
    reset() {
        wasm.liquidbrain_reset(this.__wbg_ptr);
    }
}
if (Symbol.dispose) LiquidBrain.prototype[Symbol.dispose] = LiquidBrain.prototype.free;
exports.LiquidBrain = LiquidBrain;

/**
 * Result of LP value calculation
 */
class LpValue {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(LpValue.prototype);
        obj.__wbg_ptr = ptr;
        LpValueFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LpValueFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_lpvalue_free(ptr, 0);
    }
    /**
     * @returns {bigint}
     */
    get amount_a() {
        const ret = wasm.__wbg_get_fill_price(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {bigint}
     */
    get amount_b() {
        const ret = wasm.__wbg_get_fill_quantity(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @param {bigint} arg0
     */
    set amount_a(arg0) {
        wasm.__wbg_set_fill_price(this.__wbg_ptr, arg0);
    }
    /**
     * @param {bigint} arg0
     */
    set amount_b(arg0) {
        wasm.__wbg_set_fill_quantity(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) LpValue.prototype[Symbol.dispose] = LpValue.prototype.free;
exports.LpValue = LpValue;

/**
 * High-performance order book using BTreeMap
 * Bids: sorted by price descending (highest first)
 * Asks: sorted by price ascending (lowest first)
 */
class OrderBook {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OrderBookFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_orderbook_free(ptr, 0);
    }
    /**
     * Get order book ask depth (number of price levels)
     * @returns {number}
     */
    ask_depth() {
        const ret = wasm.orderbook_ask_depth(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get total ask volume at a price level
     * @param {bigint} price
     * @returns {bigint}
     */
    ask_volume_at(price) {
        const ret = wasm.orderbook_ask_volume_at(this.__wbg_ptr, price);
        return ret;
    }
    /**
     * Get best ask price
     * @returns {bigint}
     */
    best_ask() {
        const ret = wasm.orderbook_best_ask(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get best bid price
     * @returns {bigint}
     */
    best_bid() {
        const ret = wasm.orderbook_best_bid(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get order book bid depth (number of price levels)
     * @returns {number}
     */
    bid_depth() {
        const ret = wasm.orderbook_bid_depth(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get total bid volume at a price level
     * @param {bigint} price
     * @returns {bigint}
     */
    bid_volume_at(price) {
        const ret = wasm.orderbook_bid_volume_at(this.__wbg_ptr, price);
        return ret;
    }
    /**
     * Cancel an order
     * @param {number} order_id
     * @param {OrderSide} side
     * @returns {boolean}
     */
    cancel_order(order_id, side) {
        const ret = wasm.orderbook_cancel_order(this.__wbg_ptr, order_id, side);
        return ret !== 0;
    }
    constructor() {
        const ret = wasm.orderbook_new();
        this.__wbg_ptr = ret >>> 0;
        OrderBookFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Place a limit order
     * Returns order ID
     * @param {bigint} price
     * @param {bigint} quantity
     * @param {OrderSide} side
     * @param {number} owner_id
     * @returns {number}
     */
    place_order(price, quantity, side, owner_id) {
        const ret = wasm.orderbook_place_order(this.__wbg_ptr, price, quantity, side, owner_id);
        return ret >>> 0;
    }
    /**
     * Set current timestamp (for order priority)
     * @param {bigint} time
     */
    set_time(time) {
        wasm.orderbook_set_time(this.__wbg_ptr, time);
    }
    /**
     * Get spread in fixed-point
     * @returns {bigint}
     */
    spread() {
        const ret = wasm.orderbook_spread(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) OrderBook.prototype[Symbol.dispose] = OrderBook.prototype.free;
exports.OrderBook = OrderBook;

/**
 * @enum {0 | 1}
 */
const OrderSide = Object.freeze({
    Buy: 0, "0": "Buy",
    Sell: 1, "1": "Sell",
});
exports.OrderSide = OrderSide;

/**
 * @enum {0 | 1 | 2 | 3}
 */
const OrderStatus = Object.freeze({
    Open: 0, "0": "Open",
    PartialFill: 1, "1": "PartialFill",
    Filled: 2, "2": "Filled",
    Cancelled: 3, "3": "Cancelled",
});
exports.OrderStatus = OrderStatus;

class RiskCalculator {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RiskCalculatorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_riskcalculator_free(ptr, 0);
    }
    /**
     * Calculate liquidation price
     * @param {number} side
     * @param {number} entry_price
     * @param {number} leverage
     * @param {number} maintenance_margin_rate
     * @returns {number}
     */
    calculate_liquidation_price(side, entry_price, leverage, maintenance_margin_rate) {
        const ret = wasm.riskcalculator_calculate_liquidation_price(this.__wbg_ptr, side, entry_price, leverage, maintenance_margin_rate);
        return ret;
    }
    /**
     * Calculate margin level: (Equity / Margin) * 100
     * @param {number} equity
     * @param {number} margin
     * @returns {number}
     */
    calculate_margin_level(equity, margin) {
        const ret = wasm.riskcalculator_calculate_margin_level(this.__wbg_ptr, equity, margin);
        return ret;
    }
    /**
     * Calculate required margin for a position
     * @param {number} quantity
     * @param {number} price
     * @param {number} leverage
     * @returns {number}
     */
    calculate_margin_required(quantity, price, leverage) {
        const ret = wasm.riskcalculator_calculate_margin_required(this.__wbg_ptr, quantity, price, leverage);
        return ret;
    }
    /**
     * Calculate position size for given risk percentage
     * @param {number} equity
     * @param {number} price
     * @param {number} leverage
     * @param {number} risk_percent
     * @returns {number}
     */
    calculate_position_size(equity, price, leverage, risk_percent) {
        const ret = wasm.riskcalculator_calculate_position_size(this.__wbg_ptr, equity, price, leverage, risk_percent);
        return ret;
    }
    /**
     * Calculate stop loss price for given max loss
     * @param {number} side
     * @param {number} entry_price
     * @param {number} quantity
     * @param {number} max_loss
     * @returns {number}
     */
    calculate_stop_loss(side, entry_price, quantity, max_loss) {
        const ret = wasm.riskcalculator_calculate_stop_loss(this.__wbg_ptr, side, entry_price, quantity, max_loss);
        return ret;
    }
    /**
     * Check if new position is allowed
     * @param {number} account_margin_level
     * @param {RiskLevel} account_risk_level
     * @param {number} leverage
     * @param {number} current_positions
     * @returns {boolean}
     */
    can_open_position(account_margin_level, account_risk_level, leverage, current_positions) {
        const ret = wasm.riskcalculator_can_open_position(this.__wbg_ptr, account_margin_level, account_risk_level, leverage, current_positions);
        return ret !== 0;
    }
    /**
     * Determine risk level from margin level
     * @param {number} margin_level
     * @returns {RiskLevel}
     */
    determine_risk_level(margin_level) {
        const ret = wasm.riskcalculator_determine_risk_level(this.__wbg_ptr, margin_level);
        return ret;
    }
    /**
     * @param {RiskConfig} config
     */
    constructor(config) {
        _assertClass(config, RiskConfig);
        var ptr0 = config.__destroy_into_raw();
        const ret = wasm.riskcalculator_new(ptr0);
        this.__wbg_ptr = ret >>> 0;
        RiskCalculatorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) RiskCalculator.prototype[Symbol.dispose] = RiskCalculator.prototype.free;
exports.RiskCalculator = RiskCalculator;

class RiskConfig {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RiskConfig.prototype);
        obj.__wbg_ptr = ptr;
        RiskConfigFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RiskConfigFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_riskconfig_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get liquidation_level() {
        const ret = wasm.__wbg_get_conversationdomainconfig_intrusiveness_threshold(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get max_leverage() {
        const ret = wasm.__wbg_get_riskconfig_max_leverage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get max_positions() {
        const ret = wasm.__wbg_get_riskconfig_max_positions(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get warning_level() {
        const ret = wasm.__wbg_get_conversationdomainconfig_trust_decay_rate(this.__wbg_ptr);
        return ret;
    }
    constructor() {
        const ret = wasm.riskconfig_new();
        this.__wbg_ptr = ret >>> 0;
        RiskConfigFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} liquidation
     * @param {number} warning
     * @returns {RiskConfig}
     */
    static with_levels(liquidation, warning) {
        const ret = wasm.riskconfig_with_levels(liquidation, warning);
        return RiskConfig.__wrap(ret);
    }
    /**
     * @param {number} arg0
     */
    set liquidation_level(arg0) {
        wasm.__wbg_set_conversationdomainconfig_intrusiveness_threshold(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set max_leverage(arg0) {
        wasm.__wbg_set_riskconfig_max_leverage(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set max_positions(arg0) {
        wasm.__wbg_set_riskconfig_max_positions(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set warning_level(arg0) {
        wasm.__wbg_set_conversationdomainconfig_trust_decay_rate(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) RiskConfig.prototype[Symbol.dispose] = RiskConfig.prototype.free;
exports.RiskConfig = RiskConfig;

/**
 * @enum {0 | 1 | 2 | 3}
 */
const RiskLevel = Object.freeze({
    Low: 0, "0": "Low",
    Medium: 1, "1": "Medium",
    High: 2, "2": "High",
    Liquidation: 3, "3": "Liquidation",
});
exports.RiskLevel = RiskLevel;

class Sentinel {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SentinelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sentinel_free(ptr, 0);
    }
    /**
     * @returns {SentinelMode}
     */
    get_mode() {
        const ret = wasm.sentinel_get_mode(this.__wbg_ptr);
        return ret;
    }
    /**
     * Return current thermodynamic state (Arousal/Entropy levels)
     * @returns {Float32Array}
     */
    get_thermo_state() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sentinel_get_thermo_state(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    constructor() {
        const ret = wasm.sentinel_new();
        this.__wbg_ptr = ret >>> 0;
        SentinelFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {SentinelMode} mode
     */
    set_mode(mode) {
        wasm.sentinel_set_mode(this.__wbg_ptr, mode);
    }
    /**
     * @param {number} gas_price
     * @param {number} whale_flow
     * @returns {string}
     */
    tick(gas_price, whale_flow) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sentinel_tick(retptr, this.__wbg_ptr, gas_price, whale_flow);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Sentinel.prototype[Symbol.dispose] = Sentinel.prototype.free;
exports.Sentinel = Sentinel;

/**
 * @enum {0 | 1 | 2 | 3 | 4 | 5 | 6}
 */
const SentinelMode = Object.freeze({
    Stalking: 0, "0": "Stalking",
    Berserk: 1, "1": "Berserk",
    Arbitrage: 2, "2": "Arbitrage",
    Liquidation: 3, "3": "Liquidation",
    Snipe: 4, "4": "Snipe",
    Emergency: 5, "5": "Emergency",
    Zen: 6, "6": "Zen",
});
exports.SentinelMode = SentinelMode;

/**
 * @enum {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}
 */
const SentinelVariable = Object.freeze({
    PriceDelta: 0, "0": "PriceDelta",
    VolumeSpike: 1, "1": "VolumeSpike",
    Volatility: 2, "2": "Volatility",
    Momentum: 3, "3": "Momentum",
    GasPriceGwei: 4, "4": "GasPriceGwei",
    MempoolPendingCnt: 5, "5": "MempoolPendingCnt",
    WhaleNetFlow: 6, "6": "WhaleNetFlow",
    LiquidityImbalance: 7, "7": "LiquidityImbalance",
    SmartMoneyActivity: 8, "8": "SmartMoneyActivity",
    PortfolioRisk: 9, "9": "PortfolioRisk",
    UserAction: 10, "10": "UserAction",
    Sentiment: 11, "11": "Sentiment",
    MacroFactor: 12, "12": "MacroFactor",
});
exports.SentinelVariable = SentinelVariable;

class TradingDomainConfig {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TradingDomainConfig.prototype);
        obj.__wbg_ptr = ptr;
        TradingDomainConfigFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TradingDomainConfigFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_tradingdomainconfig_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get gas_limit_gwei() {
        const ret = wasm.__wbg_get_tradingdomainconfig_gas_limit_gwei(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get max_leverage() {
        const ret = wasm.__wbg_get_tradingdomainconfig_max_leverage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get max_slippage_bps() {
        const ret = wasm.__wbg_get_tradingdomainconfig_max_slippage_bps(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {bigint}
     */
    get min_liquidity_threshold() {
        const ret = wasm.__wbg_get_fill_price(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {number}
     */
    get risk_aversion_factor() {
        const ret = wasm.__wbg_get_tradingdomainconfig_risk_aversion_factor(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set gas_limit_gwei(arg0) {
        wasm.__wbg_set_tradingdomainconfig_gas_limit_gwei(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set max_leverage(arg0) {
        wasm.__wbg_set_tradingdomainconfig_max_leverage(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set max_slippage_bps(arg0) {
        wasm.__wbg_set_tradingdomainconfig_max_slippage_bps(this.__wbg_ptr, arg0);
    }
    /**
     * @param {bigint} arg0
     */
    set min_liquidity_threshold(arg0) {
        wasm.__wbg_set_fill_price(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set risk_aversion_factor(arg0) {
        wasm.__wbg_set_tradingdomainconfig_risk_aversion_factor(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {TradingDomainConfig}
     */
    static aggressive() {
        const ret = wasm.tradingdomainconfig_aggressive();
        return TradingDomainConfig.__wrap(ret);
    }
    /**
     * @returns {TradingDomainConfig}
     */
    static conservative() {
        const ret = wasm.tradingdomainconfig_conservative();
        return TradingDomainConfig.__wrap(ret);
    }
    constructor() {
        const ret = wasm.tradingdomainconfig_new();
        this.__wbg_ptr = ret >>> 0;
        TradingDomainConfigFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) TradingDomainConfig.prototype[Symbol.dispose] = TradingDomainConfig.prototype.free;
exports.TradingDomainConfig = TradingDomainConfig;

class TraumaRegistry {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TraumaRegistryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_traumaregistry_free(ptr, 0);
    }
    /**
     * Export records as JSON for persistence
     * @returns {any}
     */
    export_records() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.traumaregistry_export_records(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get remaining inhibition time in milliseconds
     * @param {SentinelMode} mode
     * @param {string} action_name
     * @param {bigint} now_ts_ms
     * @returns {bigint}
     */
    get_remaining_ms(mode, action_name, now_ts_ms) {
        const ptr0 = passStringToWasm0(action_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.traumaregistry_get_remaining_ms(this.__wbg_ptr, mode, ptr0, len0, now_ts_ms);
        return ret;
    }
    /**
     * Remove trauma record (heal)
     * @param {SentinelMode} mode
     * @param {string} action_name
     */
    heal(mode, action_name) {
        const ptr0 = passStringToWasm0(action_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.traumaregistry_heal(this.__wbg_ptr, mode, ptr0, len0);
    }
    /**
     * Import records from JSON
     * @param {any} data
     */
    import_records(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.traumaregistry_import_records(retptr, this.__wbg_ptr, addHeapObject(data));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Check if action is inhibited
     * @param {SentinelMode} mode
     * @param {string} action_name
     * @param {bigint} now_ts_ms
     * @returns {boolean}
     */
    is_inhibited(mode, action_name, now_ts_ms) {
        const ptr0 = passStringToWasm0(action_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.traumaregistry_is_inhibited(this.__wbg_ptr, mode, ptr0, len0, now_ts_ms);
        return ret !== 0;
    }
    constructor() {
        const ret = wasm.traumaregistry_new();
        this.__wbg_ptr = ret >>> 0;
        TraumaRegistryFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Record a negative outcome ("Trauma")
     * @param {SentinelMode} mode
     * @param {string} action_name
     * @param {number} severity
     * @param {bigint} now_ts_ms
     */
    record_trauma(mode, action_name, severity, now_ts_ms) {
        const ptr0 = passStringToWasm0(action_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.traumaregistry_record_trauma(this.__wbg_ptr, mode, ptr0, len0, severity, now_ts_ms);
    }
}
if (Symbol.dispose) TraumaRegistry.prototype[Symbol.dispose] = TraumaRegistry.prototype.free;
exports.TraumaRegistry = TraumaRegistry;

class ValueInvariant {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ValueInvariantFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_valueinvariant_free(ptr, 0);
    }
    /**
     * @param {number} trade_value_usd
     * @param {number} predicted_impact
     * @returns {any}
     */
    check_invariant(trade_value_usd, predicted_impact) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.valueinvariant_check_invariant(retptr, this.__wbg_ptr, trade_value_usd, predicted_impact);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} max_drawdown_per_block
     * @param {number} max_position_size
     * @param {number} circuit_breaker_threshold
     */
    constructor(max_drawdown_per_block, max_position_size, circuit_breaker_threshold) {
        const ret = wasm.valueinvariant_new(max_drawdown_per_block, max_position_size, circuit_breaker_threshold);
        this.__wbg_ptr = ret >>> 0;
        ValueInvariantFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} total_portfolio_value
     */
    update_snapshot(total_portfolio_value) {
        wasm.valueinvariant_update_snapshot(this.__wbg_ptr, total_portfolio_value);
    }
}
if (Symbol.dispose) ValueInvariant.prototype[Symbol.dispose] = ValueInvariant.prototype.free;
exports.ValueInvariant = ValueInvariant;

/**
 * Batch calculate equity from balance and unrealized PnL
 * @param {Float32Array} balances
 * @param {Float32Array} unrealized_pnl
 * @param {Float32Array} equity
 * @param {number} count
 */
function batch_calculate_equity(balances, unrealized_pnl, equity, count) {
    const ptr0 = passArrayF32ToWasm0(balances, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(unrealized_pnl, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = passArrayF32ToWasm0(equity, wasm.__wbindgen_export);
    var len2 = WASM_VECTOR_LEN;
    wasm.batch_calculate_equity(ptr0, len0, ptr1, len1, ptr2, len2, addHeapObject(equity), count);
}
exports.batch_calculate_equity = batch_calculate_equity;

/**
 * Calculate margin levels for multiple accounts
 * @param {Float32Array} equity
 * @param {Float32Array} margin
 * @param {Float32Array} margin_level
 * @param {number} count
 */
function batch_calculate_margin_levels(equity, margin, margin_level, count) {
    const ptr0 = passArrayF32ToWasm0(equity, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(margin, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = passArrayF32ToWasm0(margin_level, wasm.__wbindgen_export);
    var len2 = WASM_VECTOR_LEN;
    wasm.batch_calculate_margin_levels(ptr0, len0, ptr1, len1, ptr2, len2, addHeapObject(margin_level), count);
}
exports.batch_calculate_margin_levels = batch_calculate_margin_levels;

/**
 * Batch check accounts for liquidation
 * Returns indices of accounts that need liquidation
 * @param {Float32Array} margin_levels
 * @param {number} liquidation_threshold
 * @returns {Uint32Array}
 */
function batch_check_liquidation(margin_levels, liquidation_threshold) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF32ToWasm0(margin_levels, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.batch_check_liquidation(retptr, ptr0, len0, liquidation_threshold);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.batch_check_liquidation = batch_check_liquidation;

/**
 * Update positions PnL from mark prices
 * This operates directly on SharedArrayBuffer data
 * @param {Float32Array} position_entry
 * @param {Float32Array} position_quantity
 * @param {Uint8Array} position_side
 * @param {Float32Array} position_pnl
 * @param {number} mark_price
 * @param {number} count
 */
function batch_update_pnl(position_entry, position_quantity, position_side, position_pnl, mark_price, count) {
    const ptr0 = passArrayF32ToWasm0(position_entry, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(position_quantity, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(position_side, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    var ptr3 = passArrayF32ToWasm0(position_pnl, wasm.__wbindgen_export);
    var len3 = WASM_VECTOR_LEN;
    wasm.batch_update_pnl(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, addHeapObject(position_pnl), mark_price, count);
}
exports.batch_update_pnl = batch_update_pnl;

/**
 * Batch update risk levels based on margin levels
 * @param {Float32Array} margin_levels
 * @param {Uint8Array} risk_levels
 * @param {number} liquidation_threshold
 * @param {number} warning_threshold
 * @param {number} count
 */
function batch_update_risk_levels(margin_levels, risk_levels, liquidation_threshold, warning_threshold, count) {
    const ptr0 = passArrayF32ToWasm0(margin_levels, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(risk_levels, wasm.__wbindgen_export);
    var len1 = WASM_VECTOR_LEN;
    wasm.batch_update_risk_levels(ptr0, len0, ptr1, len1, addHeapObject(risk_levels), liquidation_threshold, warning_threshold, count);
}
exports.batch_update_risk_levels = batch_update_risk_levels;

/**
 * Calculate LP token value from reserves
 * xy = k formula for constant product AMM
 * @param {bigint} reserve_a
 * @param {bigint} reserve_b
 * @param {bigint} total_supply
 * @param {bigint} lp_tokens
 * @returns {LpValue}
 */
function calculate_lp_value(reserve_a, reserve_b, total_supply, lp_tokens) {
    const ret = wasm.calculate_lp_value(reserve_a, reserve_b, total_supply, lp_tokens);
    return LpValue.__wrap(ret);
}
exports.calculate_lp_value = calculate_lp_value;

/**
 * Calculate price impact for a swap
 * Returns impact in basis points (100 = 1%)
 * @param {bigint} amount_in
 * @param {bigint} reserve_in
 * @param {bigint} reserve_out
 * @returns {number}
 */
function calculate_price_impact(amount_in, reserve_in, reserve_out) {
    const ret = wasm.calculate_price_impact(amount_in, reserve_in, reserve_out);
    return ret >>> 0;
}
exports.calculate_price_impact = calculate_price_impact;

/**
 * Calculate swap output for constant product AMM (x * y = k)
 * fee_bps: fee in basis points (30 = 0.3%)
 * @param {bigint} amount_in
 * @param {bigint} reserve_in
 * @param {bigint} reserve_out
 * @param {number} fee_bps
 * @returns {bigint}
 */
function calculate_swap_output(amount_in, reserve_in, reserve_out, fee_bps) {
    const ret = wasm.calculate_swap_output(amount_in, reserve_in, reserve_out, fee_bps);
    return BigInt.asUintN(64, ret);
}
exports.calculate_swap_output = calculate_swap_output;

/**
 * Convert from one decimal precision to another
 * @param {bigint} amount
 * @param {number} from_decimals
 * @param {number} to_decimals
 * @returns {bigint}
 */
function convert_decimals(amount, from_decimals, to_decimals) {
    const ret = wasm.convert_decimals(amount, from_decimals, to_decimals);
    return BigInt.asUintN(64, ret);
}
exports.convert_decimals = convert_decimals;

/**
 * Health check - returns true if WASM module is working
 * @returns {boolean}
 */
function health_check() {
    const ret = wasm.health_check();
    return ret !== 0;
}
exports.health_check = health_check;

/**
 * Initialize the WASM module with panic hook for better error messages
 */
function init() {
    wasm.init();
}
exports.init = init;

/**
 * Divide two Q64.96 numbers: (a << 96) / b
 * @param {Uint8Array} a_bytes
 * @param {Uint8Array} b_bytes
 * @returns {Uint8Array}
 */
function q64_96_div(a_bytes, b_bytes) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(a_bytes, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(b_bytes, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.q64_96_div(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.q64_96_div = q64_96_div;

/**
 * Multiply two Q64.96 numbers and shift right by 96 bits.
 * a_bytes × b_bytes → (a × b) >> 96
 * @param {Uint8Array} a_bytes
 * @param {Uint8Array} b_bytes
 * @returns {Uint8Array}
 */
function q64_96_mul(a_bytes, b_bytes) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(a_bytes, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(b_bytes, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.q64_96_mul(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.q64_96_mul = q64_96_mul;

/**
 * Convert Uniswap V3 sqrtPriceX96 → price WAD (1e18 scale).
 *
 * Formula: price_wad = (sqrt^2 / 2^192) × 10^18 × 10^(d0 - d1)
 * All arithmetic: stack-allocated U256/U512, zero heap allocation.
 * @param {Uint8Array} sqrt_price_x96_bytes
 * @param {number} token0_decimals
 * @param {number} token1_decimals
 * @returns {Uint8Array}
 */
function sqrt_price_x96_to_price_wad(sqrt_price_x96_bytes, token0_decimals, token1_decimals) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(sqrt_price_x96_bytes, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.sqrt_price_x96_to_price_wad(retptr, ptr0, len0, token0_decimals, token1_decimals);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.sqrt_price_x96_to_price_wad = sqrt_price_x96_to_price_wad;

/**
 * Divide two token amounts with proper decimal handling
 * @param {bigint} numerator
 * @param {bigint} denominator
 * @param {number} decimals
 * @returns {bigint}
 */
function token_divide(numerator, denominator, decimals) {
    const ret = wasm.token_divide(numerator, denominator, decimals);
    return BigInt.asUintN(64, ret);
}
exports.token_divide = token_divide;

/**
 * Multiply two token amounts with proper decimal handling
 * Returns result in the same decimal precision as input
 * @param {bigint} amount_a
 * @param {bigint} amount_b
 * @param {number} decimals
 * @returns {bigint}
 */
function token_multiply(amount_a, amount_b, decimals) {
    const ret = wasm.token_multiply(amount_a, amount_b, decimals);
    return BigInt.asUintN(64, ret);
}
exports.token_multiply = token_multiply;

/**
 * Calculate percentage (basis points: 10000 = 100%)
 * @param {bigint} amount
 * @param {number} bps
 * @returns {bigint}
 */
function token_percentage(amount, bps) {
    const ret = wasm.token_percentage(amount, bps);
    return BigInt.asUintN(64, ret);
}
exports.token_percentage = token_percentage;

/**
 * Get the version of the WASM core
 * @returns {string}
 */
function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.version(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
}
exports.version = version;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_Number_04624de7d0e8332d: function(arg0) {
            const ret = Number(getObject(arg0));
            return ret;
        },
        __wbg_String_8f0eb39a4a4c2f66: function(arg0, arg1) {
            const ret = String(getObject(arg1));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_8fcf4ce7f1ca72a2: function(arg0, arg1) {
            const v = getObject(arg1);
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25: function(arg0) {
            const v = getObject(arg0);
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_copy_to_typed_array_fc0809a4dec43528: function(arg0, arg1, arg2) {
            new Uint8Array(getObject(arg2).buffer, getObject(arg2).byteOffset, getObject(arg2).byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_debug_string_0bc8482c6e3508ae: function(arg0, arg1) {
            const ret = debugString(getObject(arg1));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_47fa6863be6f2f25: function(arg0, arg1) {
            const ret = getObject(arg0) in getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_is_bigint_31b12575b56f32fc: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_0095a73b8b156f76: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: function(arg0) {
            const val = getObject(arg0);
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_cd444516edc5b180: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_9e4d92534c42d778: function(arg0) {
            const ret = getObject(arg0) === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_11888390b0186270: function(arg0, arg1) {
            const ret = getObject(arg0) === getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811: function(arg0, arg1) {
            const ret = getObject(arg0) == getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_number_get_8ff4255516ccad3e: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_72fb696202c56729: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_389efe28435a9388: function() { return handleError(function (arg0, arg1) {
            const ret = getObject(arg0).call(getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_done_57b39ecd9addfe81: function(arg0) {
            const ret = getObject(arg0).done;
            return ret;
        },
        __wbg_entries_58c7934c745daac7: function(arg0) {
            const ret = Object.entries(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_error_7534b8e9a36f1ab4: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_export4(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_get_9b94d73e6221f75c: function(arg0, arg1) {
            const ret = getObject(arg0)[arg1 >>> 0];
            return addHeapObject(ret);
        },
        __wbg_get_b3ed3ad4be2bc8ac: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_get_with_ref_key_1dc361bd10053bfe: function(arg0, arg1) {
            const ret = getObject(arg0)[getObject(arg1)];
            return addHeapObject(ret);
        },
        __wbg_instanceof_ArrayBuffer_c367199e2fa2aa04: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_9b9075935c74707c: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_d314bb98fcf08331: function(arg0) {
            const ret = Array.isArray(getObject(arg0));
            return ret;
        },
        __wbg_isSafeInteger_bfbc7332a9768d2a: function(arg0) {
            const ret = Number.isSafeInteger(getObject(arg0));
            return ret;
        },
        __wbg_iterator_6ff6560ca1568e55: function() {
            const ret = Symbol.iterator;
            return addHeapObject(ret);
        },
        __wbg_length_32ed9a279acd054c: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_length_35a7bace40f36eac: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_new_361308b2356cecd0: function() {
            const ret = new Object();
            return addHeapObject(ret);
        },
        __wbg_new_3eb36ae241fe6f44: function() {
            const ret = new Array();
            return addHeapObject(ret);
        },
        __wbg_new_8a6f238a6ece86ea: function() {
            const ret = new Error();
            return addHeapObject(ret);
        },
        __wbg_new_dca287b076112a51: function() {
            const ret = new Map();
            return addHeapObject(ret);
        },
        __wbg_new_dd2b680c8bf6ae29: function(arg0) {
            const ret = new Uint8Array(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_next_3482f54c49e8af19: function() { return handleError(function (arg0) {
            const ret = getObject(arg0).next();
            return addHeapObject(ret);
        }, arguments); },
        __wbg_next_418f80d8f5303233: function(arg0) {
            const ret = getObject(arg0).next;
            return addHeapObject(ret);
        },
        __wbg_prototypesetcall_bdcdcc5842e4d77d: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_set_1eb0999cf5d27fc8: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        },
        __wbg_set_3f1d0b984ed272ed: function(arg0, arg1, arg2) {
            getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
        },
        __wbg_set_f43e577aea94465b: function(arg0, arg1, arg2) {
            getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
        },
        __wbg_stack_0ed75d68575b0f3c: function(arg0, arg1) {
            const ret = getObject(arg1).stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_0546255b415e96c1: function(arg0) {
            const ret = getObject(arg0).value;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000004: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_clone_ref: function(arg0) {
            const ret = getObject(arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./core_rust_bg.js": import0,
    };
}

const AntiRugFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_antirug_free(ptr >>> 0, 1));
const CausalGraphFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_causalgraph_free(ptr >>> 0, 1));
const ConversationDomainConfigFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_conversationdomainconfig_free(ptr >>> 0, 1));
const CounterfactualResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_counterfactualresult_free(ptr >>> 0, 1));
const FillFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fill_free(ptr >>> 0, 1));
const HyperMemoryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_hypermemory_free(ptr >>> 0, 1));
const IntervenableFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intervenable_free(ptr >>> 0, 1));
const LiquidBrainFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_liquidbrain_free(ptr >>> 0, 1));
const LpValueFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_lpvalue_free(ptr >>> 0, 1));
const OrderBookFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_orderbook_free(ptr >>> 0, 1));
const RiskCalculatorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_riskcalculator_free(ptr >>> 0, 1));
const RiskConfigFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_riskconfig_free(ptr >>> 0, 1));
const SentinelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sentinel_free(ptr >>> 0, 1));
const TradingDomainConfigFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_tradingdomainconfig_free(ptr >>> 0, 1));
const TraumaRegistryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_traumaregistry_free(ptr >>> 0, 1));
const ValueInvariantFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_valueinvariant_free(ptr >>> 0, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export3(addHeapObject(e));
    }
}

let heap = new Array(128).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/core_rust_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
const wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
