#[starknet::contract]
pub mod GuildRegistry {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_contract_address, get_block_timestamp};
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use crate::interfaces::{
        IGuildRegistry, GuildInfo, IERC20TransferDispatcher, IERC20TransferDispatcherTrait,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
        stake_token: ContractAddress,
        guild_counter: u256,
        guilds_creator: Map<u256, ContractAddress>,
        guilds_name_hash: Map<u256, felt252>,
        guilds_min_stake: Map<u256, u256>,
        guilds_member_count: Map<u256, u32>,
        guilds_total_staked: Map<u256, u256>,
        guilds_created_at: Map<u256, u64>,
        // (guild_id, member) -> stake amount (0 = not a member)
        member_stakes: Map<(u256, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        GuildCreated: GuildCreated,
        MemberJoined: MemberJoined,
        MemberLeft: MemberLeft,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GuildCreated {
        #[key]
        pub guild_id: u256,
        pub creator: ContractAddress,
        pub min_stake: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MemberJoined {
        #[key]
        pub guild_id: u256,
        pub member: ContractAddress,
        pub stake_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MemberLeft {
        #[key]
        pub guild_id: u256,
        pub member: ContractAddress,
        pub returned_stake: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, stake_token: ContractAddress) {
        self.ownable.initializer(owner);
        self.stake_token.write(stake_token);
        self.guild_counter.write(0);
    }

    #[abi(embed_v0)]
    impl GuildRegistryImpl of IGuildRegistry<ContractState> {
        fn create_guild(ref self: ContractState, name_hash: felt252, min_stake: u256) -> u256 {
            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(name_hash != 0, 'name hash required');
            assert(min_stake > 0, 'min stake must be > 0');

            let guild_id = self.guild_counter.read() + 1;
            self.guild_counter.write(guild_id);

            self.guilds_creator.entry(guild_id).write(caller);
            self.guilds_name_hash.entry(guild_id).write(name_hash);
            self.guilds_min_stake.entry(guild_id).write(min_stake);
            self.guilds_member_count.entry(guild_id).write(0);
            self.guilds_total_staked.entry(guild_id).write(0);
            self.guilds_created_at.entry(guild_id).write(get_block_timestamp());

            self.emit(GuildCreated { guild_id, creator: caller, min_stake });

            guild_id
        }

        fn join_guild(ref self: ContractState, guild_id: u256, stake_amount: u256) {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');

            let min_stake = self.guilds_min_stake.entry(guild_id).read();
            assert(min_stake > 0, 'guild does not exist');
            assert(stake_amount >= min_stake, 'stake below minimum');

            let existing = self.member_stakes.entry((guild_id, caller)).read();
            assert(existing == 0, 'already a member');

            // Transfer stake to contract
            let token = IERC20TransferDispatcher {
                contract_address: self.stake_token.read(),
            };
            token.transfer_from(caller, get_contract_address(), stake_amount);

            self.member_stakes.entry((guild_id, caller)).write(stake_amount);
            let count = self.guilds_member_count.entry(guild_id).read();
            self.guilds_member_count.entry(guild_id).write(count + 1);
            let total = self.guilds_total_staked.entry(guild_id).read();
            self.guilds_total_staked.entry(guild_id).write(total + stake_amount);

            self.emit(MemberJoined { guild_id, member: caller, stake_amount });

            self.reentrancy_guard.end();
        }

        fn leave_guild(ref self: ContractState, guild_id: u256) {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            let stake = self.member_stakes.entry((guild_id, caller)).read();
            assert(stake > 0, 'not a member');

            // Return stake
            let token = IERC20TransferDispatcher {
                contract_address: self.stake_token.read(),
            };
            token.transfer(caller, stake);

            self.member_stakes.entry((guild_id, caller)).write(0);
            let count = self.guilds_member_count.entry(guild_id).read();
            self.guilds_member_count.entry(guild_id).write(count - 1);
            let total = self.guilds_total_staked.entry(guild_id).read();
            self.guilds_total_staked.entry(guild_id).write(total - stake);

            self.emit(MemberLeft { guild_id, member: caller, returned_stake: stake });

            self.reentrancy_guard.end();
        }

        fn get_guild(self: @ContractState, guild_id: u256) -> GuildInfo {
            GuildInfo {
                creator: self.guilds_creator.entry(guild_id).read(),
                name_hash: self.guilds_name_hash.entry(guild_id).read(),
                min_stake: self.guilds_min_stake.entry(guild_id).read(),
                member_count: self.guilds_member_count.entry(guild_id).read(),
                total_staked: self.guilds_total_staked.entry(guild_id).read(),
                created_at: self.guilds_created_at.entry(guild_id).read(),
            }
        }

        fn get_guild_count(self: @ContractState) -> u256 {
            self.guild_counter.read()
        }

        fn is_member(self: @ContractState, guild_id: u256, member: ContractAddress) -> bool {
            self.member_stakes.entry((guild_id, member)).read() > 0
        }

        fn get_member_stake(self: @ContractState, guild_id: u256, member: ContractAddress) -> u256 {
            self.member_stakes.entry((guild_id, member)).read()
        }
    }
}
