#[starknet::contract]
pub mod TaskEscrow {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use crate::interfaces::{
        ITaskEscrow, TaskInfo, TaskStatus, BidInfo, DisputeRuling,
        IERC20TransferDispatcher, IERC20TransferDispatcherTrait,
    };

    /// Default dispute resolution window: 7 days after dispute is filed.
    /// After this, either party can force-settle.
    const DISPUTE_WINDOW_SECONDS: u64 = 604800;

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
        collateral_token: ContractAddress,
        task_counter: u256,
        // task_id -> TaskInfo
        tasks_poster: Map<u256, ContractAddress>,
        tasks_description_hash: Map<u256, felt252>,
        tasks_reward_amount: Map<u256, u256>,
        tasks_deadline: Map<u256, u64>,
        tasks_required_validators: Map<u256, u8>,
        tasks_status: Map<u256, u8>,
        tasks_assignee: Map<u256, ContractAddress>,
        tasks_proof_hash: Map<u256, felt252>,
        tasks_created_at: Map<u256, u64>,
        // task_id -> timestamp when dispute was filed (0 if not disputed)
        tasks_disputed_at: Map<u256, u64>,
        // task_id -> bid count
        bid_counts: Map<u256, u256>,
        // (task_id, index) -> BidInfo
        bids_bidder: Map<(u256, u256), ContractAddress>,
        bids_amount: Map<(u256, u256), u256>,
        bids_timestamp: Map<(u256, u256), u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        TaskPosted: TaskPosted,
        TaskBid: TaskBid,
        BidAccepted: BidAccepted,
        ProofSubmitted: ProofSubmitted,
        TaskApproved: TaskApproved,
        TaskDisputed: TaskDisputed,
        DisputeResolved: DisputeResolved,
        DisputeForceSettled: DisputeForceSettled,
        TaskCancelled: TaskCancelled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TaskPosted {
        #[key]
        pub task_id: u256,
        pub poster: ContractAddress,
        pub reward_amount: u256,
        pub deadline: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TaskBid {
        #[key]
        pub task_id: u256,
        pub bidder: ContractAddress,
        pub bid_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BidAccepted {
        #[key]
        pub task_id: u256,
        pub bidder: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProofSubmitted {
        #[key]
        pub task_id: u256,
        pub proof_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TaskApproved {
        #[key]
        pub task_id: u256,
        pub reward_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TaskDisputed {
        #[key]
        pub task_id: u256,
        pub reason_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DisputeResolved {
        #[key]
        pub task_id: u256,
        pub ruling: u8, // 0=AssigneeWins, 1=PosterWins, 2=Split
        pub assignee_amount: u256,
        pub poster_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DisputeForceSettled {
        #[key]
        pub task_id: u256,
        pub settled_by: ContractAddress,
        pub refund_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TaskCancelled {
        #[key]
        pub task_id: u256,
    }

    fn status_to_u8(status: TaskStatus) -> u8 {
        match status {
            TaskStatus::Open => 0,
            TaskStatus::Assigned => 1,
            TaskStatus::Submitted => 2,
            TaskStatus::Approved => 3,
            TaskStatus::Disputed => 4,
            TaskStatus::Cancelled => 5,
            TaskStatus::Settled => 6,
        }
    }

    fn u8_to_status(val: u8) -> TaskStatus {
        if val == 0 {
            TaskStatus::Open
        } else if val == 1 {
            TaskStatus::Assigned
        } else if val == 2 {
            TaskStatus::Submitted
        } else if val == 3 {
            TaskStatus::Approved
        } else if val == 4 {
            TaskStatus::Disputed
        } else if val == 5 {
            TaskStatus::Cancelled
        } else if val == 6 {
            TaskStatus::Settled
        } else {
            panic!("invalid task status")
        }
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, collateral_token: ContractAddress) {
        self.ownable.initializer(owner);
        self.collateral_token.write(collateral_token);
        self.task_counter.write(0);
    }

    #[abi(embed_v0)]
    impl TaskEscrowImpl of ITaskEscrow<ContractState> {
        fn post_task(
            ref self: ContractState,
            description_hash: felt252,
            reward_amount: u256,
            deadline: u64,
            required_validators: u8,
        ) -> u256 {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(reward_amount > 0, 'reward must be > 0');
            assert(deadline > get_block_timestamp(), 'deadline must be future');
            assert(description_hash != 0, 'description hash required');

            // Transfer reward from poster to escrow
            let token = IERC20TransferDispatcher {
                contract_address: self.collateral_token.read(),
            };
            token.transfer_from(caller, starknet::get_contract_address(), reward_amount);

            let task_id = self.task_counter.read() + 1;
            self.task_counter.write(task_id);

            self.tasks_poster.entry(task_id).write(caller);
            self.tasks_description_hash.entry(task_id).write(description_hash);
            self.tasks_reward_amount.entry(task_id).write(reward_amount);
            self.tasks_deadline.entry(task_id).write(deadline);
            self.tasks_required_validators.entry(task_id).write(required_validators);
            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Open));
            self.tasks_assignee.entry(task_id).write(Zero::zero());
            self.tasks_proof_hash.entry(task_id).write(0);
            self.tasks_created_at.entry(task_id).write(get_block_timestamp());
            self.bid_counts.entry(task_id).write(0);

            self.emit(TaskPosted { task_id, poster: caller, reward_amount, deadline });

            self.reentrancy_guard.end();
            task_id
        }

        fn bid_task(ref self: ContractState, task_id: u256, bid_amount: u256) {
            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');

            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Open, 'task not open');
            assert(get_block_timestamp() < self.tasks_deadline.entry(task_id).read(), 'task expired');
            assert(bid_amount > 0, 'bid must be > 0');

            let poster = self.tasks_poster.entry(task_id).read();
            assert(caller != poster, 'poster cannot bid');

            let bid_index = self.bid_counts.entry(task_id).read();
            self.bids_bidder.entry((task_id, bid_index)).write(caller);
            self.bids_amount.entry((task_id, bid_index)).write(bid_amount);
            self.bids_timestamp.entry((task_id, bid_index)).write(get_block_timestamp());
            self.bid_counts.entry(task_id).write(bid_index + 1);

            self.emit(TaskBid { task_id, bidder: caller, bid_amount });
        }

        fn accept_bid(ref self: ContractState, task_id: u256, bidder: ContractAddress) {
            let caller = get_caller_address();
            let poster = self.tasks_poster.entry(task_id).read();
            assert(caller == poster, 'only poster can accept');

            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Open, 'task not open');
            assert(!bidder.is_zero(), 'bidder is zero');

            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Assigned));
            self.tasks_assignee.entry(task_id).write(bidder);

            self.emit(BidAccepted { task_id, bidder });
        }

        fn submit_proof(ref self: ContractState, task_id: u256, proof_hash: felt252) {
            let caller = get_caller_address();
            let assignee = self.tasks_assignee.entry(task_id).read();
            assert(caller == assignee, 'only assignee can submit');
            assert(proof_hash != 0, 'proof hash required');

            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Assigned, 'task not assigned');

            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Submitted));
            self.tasks_proof_hash.entry(task_id).write(proof_hash);

            self.emit(ProofSubmitted { task_id, proof_hash });
        }

        fn approve_task(ref self: ContractState, task_id: u256) {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            let poster = self.tasks_poster.entry(task_id).read();
            assert(caller == poster, 'only poster can approve');

            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Submitted, 'task not submitted');

            let assignee = self.tasks_assignee.entry(task_id).read();
            let reward = self.tasks_reward_amount.entry(task_id).read();

            // Release reward to assignee
            let token = IERC20TransferDispatcher {
                contract_address: self.collateral_token.read(),
            };
            token.transfer(assignee, reward);

            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Approved));

            self.emit(TaskApproved { task_id, reward_amount: reward });

            self.reentrancy_guard.end();
        }

        fn dispute_task(ref self: ContractState, task_id: u256, reason_hash: felt252) {
            let caller = get_caller_address();
            let poster = self.tasks_poster.entry(task_id).read();
            assert(caller == poster, 'only poster can dispute');

            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Submitted, 'task not submitted');

            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Disputed));
            self.tasks_disputed_at.entry(task_id).write(get_block_timestamp());

            self.emit(TaskDisputed { task_id, reason_hash });
        }

        fn cancel_task(ref self: ContractState, task_id: u256) {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            let poster = self.tasks_poster.entry(task_id).read();
            assert(caller == poster, 'only poster can cancel');

            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Open, 'can only cancel open tasks');

            // Refund poster
            let reward = self.tasks_reward_amount.entry(task_id).read();
            let token = IERC20TransferDispatcher {
                contract_address: self.collateral_token.read(),
            };
            token.transfer(poster, reward);

            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Cancelled));

            self.emit(TaskCancelled { task_id });

            self.reentrancy_guard.end();
        }

        fn resolve_dispute(ref self: ContractState, task_id: u256, ruling: DisputeRuling) {
            self.reentrancy_guard.start();

            // Only contract owner can arbitrate
            self.ownable.assert_only_owner();

            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Disputed, 'task not disputed');

            let reward = self.tasks_reward_amount.entry(task_id).read();
            let poster = self.tasks_poster.entry(task_id).read();
            let assignee = self.tasks_assignee.entry(task_id).read();
            let token = IERC20TransferDispatcher {
                contract_address: self.collateral_token.read(),
            };

            let (assignee_amount, poster_amount, ruling_u8) = match ruling {
                DisputeRuling::AssigneeWins => {
                    token.transfer(assignee, reward);
                    (reward, 0_u256, 0_u8)
                },
                DisputeRuling::PosterWins => {
                    token.transfer(poster, reward);
                    (0_u256, reward, 1_u8)
                },
                DisputeRuling::Split => {
                    let half = reward / 2;
                    let remainder = reward - half; // poster gets remainder if odd
                    token.transfer(assignee, half);
                    token.transfer(poster, remainder);
                    (half, remainder, 2_u8)
                },
            };

            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Settled));

            self.emit(DisputeResolved {
                task_id, ruling: ruling_u8, assignee_amount, poster_amount,
            });

            self.reentrancy_guard.end();
        }

        fn force_settle_dispute(ref self: ContractState, task_id: u256) {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            let status = u8_to_status(self.tasks_status.entry(task_id).read());
            assert(status == TaskStatus::Disputed, 'task not disputed');

            // Only poster or assignee can force settle
            let poster = self.tasks_poster.entry(task_id).read();
            let assignee = self.tasks_assignee.entry(task_id).read();
            assert(caller == poster || caller == assignee, 'only poster or assignee');

            // Must be past the dispute window
            let disputed_at = self.tasks_disputed_at.entry(task_id).read();
            assert(disputed_at > 0, 'dispute timestamp missing');
            let dispute_deadline = disputed_at + DISPUTE_WINDOW_SECONDS;
            assert(get_block_timestamp() >= dispute_deadline, 'dispute window not expired');

            // Default: full refund to poster (conservative — poster deposited the funds)
            let reward = self.tasks_reward_amount.entry(task_id).read();
            let token = IERC20TransferDispatcher {
                contract_address: self.collateral_token.read(),
            };
            token.transfer(poster, reward);

            self.tasks_status.entry(task_id).write(status_to_u8(TaskStatus::Settled));

            self.emit(DisputeForceSettled { task_id, settled_by: caller, refund_amount: reward });

            self.reentrancy_guard.end();
        }

        fn get_dispute_deadline(self: @ContractState, task_id: u256) -> u64 {
            let disputed_at = self.tasks_disputed_at.entry(task_id).read();
            if disputed_at == 0 {
                return 0;
            }
            disputed_at + DISPUTE_WINDOW_SECONDS
        }

        fn get_task(self: @ContractState, task_id: u256) -> TaskInfo {
            TaskInfo {
                poster: self.tasks_poster.entry(task_id).read(),
                description_hash: self.tasks_description_hash.entry(task_id).read(),
                reward_amount: self.tasks_reward_amount.entry(task_id).read(),
                deadline: self.tasks_deadline.entry(task_id).read(),
                required_validators: self.tasks_required_validators.entry(task_id).read(),
                status: u8_to_status(self.tasks_status.entry(task_id).read()),
                assignee: self.tasks_assignee.entry(task_id).read(),
                proof_hash: self.tasks_proof_hash.entry(task_id).read(),
                created_at: self.tasks_created_at.entry(task_id).read(),
            }
        }

        fn get_bid_count(self: @ContractState, task_id: u256) -> u256 {
            self.bid_counts.entry(task_id).read()
        }

        fn get_bid(self: @ContractState, task_id: u256, index: u256) -> BidInfo {
            BidInfo {
                bidder: self.bids_bidder.entry((task_id, index)).read(),
                bid_amount: self.bids_amount.entry((task_id, index)).read(),
                timestamp: self.bids_timestamp.entry((task_id, index)).read(),
            }
        }

        fn get_task_count(self: @ContractState) -> u256 {
            self.task_counter.read()
        }
    }
}
