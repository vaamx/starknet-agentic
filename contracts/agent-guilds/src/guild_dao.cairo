#[starknet::contract]
pub mod GuildDAO {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use crate::interfaces::{
        IGuildDAO, ProposalInfo, ProposalStatus, IGuildRegistryDispatcher,
        IGuildRegistryDispatcherTrait,
    };

    #[storage]
    struct Storage {
        guild_registry: ContractAddress,
        proposal_counter: u256,
        // proposal_id -> proposal fields
        proposals_guild_id: Map<u256, u256>,
        proposals_proposer: Map<u256, ContractAddress>,
        proposals_description_hash: Map<u256, felt252>,
        proposals_yes_votes: Map<u256, u256>,
        proposals_no_votes: Map<u256, u256>,
        proposals_quorum: Map<u256, u256>,
        proposals_deadline: Map<u256, u64>,
        proposals_status: Map<u256, u8>,
        proposals_created_at: Map<u256, u64>,
        // (proposal_id, voter) -> has voted
        has_voted: Map<(u256, ContractAddress), bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ProposalCreated: ProposalCreated,
        Voted: Voted,
        ProposalExecuted: ProposalExecuted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProposalCreated {
        #[key]
        pub proposal_id: u256,
        pub guild_id: u256,
        pub proposer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Voted {
        #[key]
        pub proposal_id: u256,
        pub voter: ContractAddress,
        pub support: bool,
        pub weight: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProposalExecuted {
        #[key]
        pub proposal_id: u256,
    }

    fn status_to_u8(s: ProposalStatus) -> u8 {
        match s {
            ProposalStatus::Active => 0,
            ProposalStatus::Passed => 1,
            ProposalStatus::Rejected => 2,
            ProposalStatus::Executed => 3,
            ProposalStatus::Cancelled => 4,
        }
    }

    fn u8_to_status(v: u8) -> ProposalStatus {
        if v == 0 {
            ProposalStatus::Active
        } else if v == 1 {
            ProposalStatus::Passed
        } else if v == 2 {
            ProposalStatus::Rejected
        } else if v == 3 {
            ProposalStatus::Executed
        } else {
            ProposalStatus::Cancelled
        }
    }

    #[constructor]
    fn constructor(ref self: ContractState, guild_registry: ContractAddress) {
        self.guild_registry.write(guild_registry);
        self.proposal_counter.write(0);
    }

    #[abi(embed_v0)]
    impl GuildDAOImpl of IGuildDAO<ContractState> {
        fn propose(
            ref self: ContractState,
            guild_id: u256,
            description_hash: felt252,
            quorum: u256,
            deadline: u64,
        ) -> u256 {
            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(description_hash != 0, 'description required');
            assert(deadline > get_block_timestamp(), 'deadline must be future');

            // Verify membership
            let registry = IGuildRegistryDispatcher {
                contract_address: self.guild_registry.read(),
            };
            assert(registry.is_member(guild_id, caller), 'not a guild member');

            let proposal_id = self.proposal_counter.read() + 1;
            self.proposal_counter.write(proposal_id);

            self.proposals_guild_id.entry(proposal_id).write(guild_id);
            self.proposals_proposer.entry(proposal_id).write(caller);
            self.proposals_description_hash.entry(proposal_id).write(description_hash);
            self.proposals_yes_votes.entry(proposal_id).write(0);
            self.proposals_no_votes.entry(proposal_id).write(0);
            self.proposals_quorum.entry(proposal_id).write(quorum);
            self.proposals_deadline.entry(proposal_id).write(deadline);
            self.proposals_status.entry(proposal_id).write(status_to_u8(ProposalStatus::Active));
            self.proposals_created_at.entry(proposal_id).write(get_block_timestamp());

            self.emit(ProposalCreated { proposal_id, guild_id, proposer: caller });

            proposal_id
        }

        fn vote(ref self: ContractState, proposal_id: u256, support: bool) {
            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');

            let status = u8_to_status(self.proposals_status.entry(proposal_id).read());
            assert(status == ProposalStatus::Active, 'proposal not active');
            assert(get_block_timestamp() < self.proposals_deadline.entry(proposal_id).read(), 'voting ended');
            assert(!self.has_voted.entry((proposal_id, caller)).read(), 'already voted');

            let guild_id = self.proposals_guild_id.entry(proposal_id).read();
            let registry = IGuildRegistryDispatcher {
                contract_address: self.guild_registry.read(),
            };
            assert(registry.is_member(guild_id, caller), 'not a guild member');

            // Stake-weighted voting
            let weight = registry.get_member_stake(guild_id, caller);
            assert(weight > 0, 'no stake weight');

            self.has_voted.entry((proposal_id, caller)).write(true);

            if support {
                let current = self.proposals_yes_votes.entry(proposal_id).read();
                self.proposals_yes_votes.entry(proposal_id).write(current + weight);
            } else {
                let current = self.proposals_no_votes.entry(proposal_id).read();
                self.proposals_no_votes.entry(proposal_id).write(current + weight);
            }

            self.emit(Voted { proposal_id, voter: caller, support, weight });
        }

        fn execute(ref self: ContractState, proposal_id: u256) {
            let status = u8_to_status(self.proposals_status.entry(proposal_id).read());
            assert(status == ProposalStatus::Active, 'proposal not active');

            let deadline = self.proposals_deadline.entry(proposal_id).read();
            assert(get_block_timestamp() >= deadline, 'voting not ended');

            let yes = self.proposals_yes_votes.entry(proposal_id).read();
            let no = self.proposals_no_votes.entry(proposal_id).read();
            let quorum = self.proposals_quorum.entry(proposal_id).read();

            if yes + no >= quorum && yes > no {
                self.proposals_status.entry(proposal_id).write(status_to_u8(ProposalStatus::Executed));
                self.emit(ProposalExecuted { proposal_id });
            } else {
                self.proposals_status.entry(proposal_id).write(status_to_u8(ProposalStatus::Rejected));
            }
        }

        fn cancel(ref self: ContractState, proposal_id: u256) {
            let caller = get_caller_address();
            let proposer = self.proposals_proposer.entry(proposal_id).read();
            assert(caller == proposer, 'only proposer can cancel');

            let status = u8_to_status(self.proposals_status.entry(proposal_id).read());
            assert(status == ProposalStatus::Active, 'proposal not active');

            self.proposals_status.entry(proposal_id).write(status_to_u8(ProposalStatus::Cancelled));
        }

        fn get_proposal(self: @ContractState, proposal_id: u256) -> ProposalInfo {
            ProposalInfo {
                proposer: self.proposals_proposer.entry(proposal_id).read(),
                description_hash: self.proposals_description_hash.entry(proposal_id).read(),
                yes_votes: self.proposals_yes_votes.entry(proposal_id).read(),
                no_votes: self.proposals_no_votes.entry(proposal_id).read(),
                quorum: self.proposals_quorum.entry(proposal_id).read(),
                deadline: self.proposals_deadline.entry(proposal_id).read(),
                status: u8_to_status(self.proposals_status.entry(proposal_id).read()),
                created_at: self.proposals_created_at.entry(proposal_id).read(),
            }
        }

        fn get_proposal_count(self: @ContractState) -> u256 {
            self.proposal_counter.read()
        }

        fn distribute(ref self: ContractState, guild_id: u256, amount: u256) {
            // Distribution logic: proportional to stake
            // This is a simplified placeholder — in production, iterate members
            let caller = get_caller_address();
            let registry = IGuildRegistryDispatcher {
                contract_address: self.guild_registry.read(),
            };
            assert(registry.is_member(guild_id, caller), 'not a guild member');
            // Full distribution requires member enumeration — deferred to v2
        }
    }
}
