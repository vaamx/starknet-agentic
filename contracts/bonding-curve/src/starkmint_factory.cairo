#[starknet::contract]
pub mod StarkMintFactory {
    use starknet::storage::*;
    use starknet::{
        ContractAddress, ClassHash, get_caller_address, get_block_timestamp,
        syscalls::deploy_syscall, SyscallResultTrait,
    };
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::interfaces::{IStarkMintFactory, LaunchInfo, CurveType};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        token_class_hash: ClassHash,
        curve_class_hash: ClassHash,
        reserve_token: ContractAddress,
        launch_count: u256,
        // index -> LaunchInfo fields
        launches_token: Map<u256, ContractAddress>,
        launches_curve: Map<u256, ContractAddress>,
        launches_creator: Map<u256, ContractAddress>,
        launches_curve_type: Map<u256, u8>,
        launches_agent_id: Map<u256, u256>,
        launches_created_at: Map<u256, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        TokenLaunched: TokenLaunched,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokenLaunched {
        #[key]
        pub index: u256,
        pub token: ContractAddress,
        pub curve: ContractAddress,
        pub creator: ContractAddress,
        pub agent_id: u256,
    }

    fn curve_type_to_u8(ct: CurveType) -> u8 {
        match ct {
            CurveType::Linear => 0,
            CurveType::Quadratic => 1,
            CurveType::Sigmoid => 2,
        }
    }

    /// Convert a short-string felt252 into a ByteArray (single-word, ≤31 bytes).
    fn felt252_to_byte_array(value: felt252) -> ByteArray {
        let mut ba: ByteArray = "";
        if value != 0 {
            let mut len: u32 = 0;
            let mut temp: u256 = value.into();
            while temp > 0 {
                temp = temp / 256;
                len += 1;
            };
            ba.append_word(value, len);
        }
        ba
    }

    fn u8_to_curve_type(v: u8) -> CurveType {
        if v == 0 {
            CurveType::Linear
        } else if v == 1 {
            CurveType::Quadratic
        } else {
            CurveType::Sigmoid
        }
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        token_class_hash: ClassHash,
        curve_class_hash: ClassHash,
        reserve_token: ContractAddress,
    ) {
        self.ownable.initializer(owner);
        self.token_class_hash.write(token_class_hash);
        self.curve_class_hash.write(curve_class_hash);
        self.reserve_token.write(reserve_token);
        self.launch_count.write(0);
    }

    #[abi(embed_v0)]
    impl StarkMintFactoryImpl of IStarkMintFactory<ContractState> {
        fn launch_token(
            ref self: ContractState,
            name: felt252,
            symbol: felt252,
            curve_type: CurveType,
            fee_bps: u16,
            agent_id: u256,
        ) -> (ContractAddress, ContractAddress) {
            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(fee_bps <= 1000, 'fee too high');

            let index = self.launch_count.read();

            // Generate unique salt
            let mut salt_input = array![name, symbol, index.low.into()];
            let salt = poseidon_hash_span(salt_input.span());

            // Deploy token
            let mut token_calldata = array![];
            // AgentToken constructor: (name: ByteArray, symbol: ByteArray, owner: ContractAddress)
            // Convert felt252 name/symbol to single-word ByteArray for the ERC-20 constructor
            let name_ba = felt252_to_byte_array(name);
            let symbol_ba = felt252_to_byte_array(symbol);
            name_ba.serialize(ref token_calldata);
            symbol_ba.serialize(ref token_calldata);
            caller.serialize(ref token_calldata);

            let (token_addr, _) = deploy_syscall(
                self.token_class_hash.read(), salt, token_calldata.span(), false,
            )
                .unwrap_syscall();

            // Deploy curve
            let mut curve_calldata = array![];
            token_addr.serialize(ref curve_calldata);
            self.reserve_token.read().serialize(ref curve_calldata);
            curve_type_to_u8(curve_type).serialize(ref curve_calldata);
            fee_bps.serialize(ref curve_calldata);
            caller.serialize(ref curve_calldata);

            let curve_salt = poseidon_hash_span(array![salt, 'curve'].span());
            let (curve_addr, _) = deploy_syscall(
                self.curve_class_hash.read(), curve_salt, curve_calldata.span(), false,
            )
                .unwrap_syscall();

            // Store launch info
            self.launches_token.entry(index).write(token_addr);
            self.launches_curve.entry(index).write(curve_addr);
            self.launches_creator.entry(index).write(caller);
            self.launches_curve_type.entry(index).write(curve_type_to_u8(curve_type));
            self.launches_agent_id.entry(index).write(agent_id);
            self.launches_created_at.entry(index).write(get_block_timestamp());
            self.launch_count.write(index + 1);

            self.emit(TokenLaunched { index, token: token_addr, curve: curve_addr, creator: caller, agent_id });

            (token_addr, curve_addr)
        }

        fn get_launch(self: @ContractState, index: u256) -> LaunchInfo {
            LaunchInfo {
                token: self.launches_token.entry(index).read(),
                curve: self.launches_curve.entry(index).read(),
                creator: self.launches_creator.entry(index).read(),
                curve_type: u8_to_curve_type(self.launches_curve_type.entry(index).read()),
                agent_id: self.launches_agent_id.entry(index).read(),
                created_at: self.launches_created_at.entry(index).read(),
            }
        }

        fn get_launch_count(self: @ContractState) -> u256 {
            self.launch_count.read()
        }
    }
}
