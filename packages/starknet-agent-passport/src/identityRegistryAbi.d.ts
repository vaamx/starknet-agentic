export declare const identityRegistryAbi: readonly [{
    readonly type: "function";
    readonly name: "set_metadata";
    readonly inputs: readonly [{
        readonly name: "agent_id";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "key";
        readonly type: "core::byte_array::ByteArray";
    }, {
        readonly name: "value";
        readonly type: "core::byte_array::ByteArray";
    }];
    readonly outputs: readonly [];
    readonly state_mutability: "external";
}, {
    readonly type: "function";
    readonly name: "get_metadata";
    readonly inputs: readonly [{
        readonly name: "agent_id";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "key";
        readonly type: "core::byte_array::ByteArray";
    }];
    readonly outputs: readonly [{
        readonly type: "core::byte_array::ByteArray";
    }];
    readonly state_mutability: "view";
}, {
    readonly type: "function";
    readonly name: "agent_exists";
    readonly inputs: readonly [{
        readonly name: "agent_id";
        readonly type: "core::integer::u256";
    }];
    readonly outputs: readonly [{
        readonly type: "core::bool";
    }];
    readonly state_mutability: "view";
}];
