#[starknet::contract]
pub mod StarkCastFeed {
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use crate::interfaces::{
        IStarkCastFeed, PostInfo, IERC20TransferDispatcher, IERC20TransferDispatcherTrait,
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
        tip_token: ContractAddress,
        post_counter: u256,
        // Post data (flat maps keyed by post_id)
        posts_author: Map<u256, ContractAddress>,
        posts_content_hash: Map<u256, felt252>,
        posts_proof_hash: Map<u256, felt252>,
        posts_tip_total: Map<u256, u256>,
        posts_like_count: Map<u256, u32>,
        posts_reply_to: Map<u256, u256>,
        posts_created_at: Map<u256, u64>,
        // (post_id, user) -> liked (1 = liked, 0 = not)
        likes: Map<(u256, ContractAddress), u8>,
        // author -> cumulative tips received
        author_tips: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        PostCreated: PostCreated,
        PostLiked: PostLiked,
        PostUnliked: PostUnliked,
        PostTipped: PostTipped,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PostCreated {
        #[key]
        pub post_id: u256,
        pub author: ContractAddress,
        pub content_hash: felt252,
        pub proof_hash: felt252,
        pub reply_to: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PostLiked {
        #[key]
        pub post_id: u256,
        pub liker: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PostUnliked {
        #[key]
        pub post_id: u256,
        pub liker: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PostTipped {
        #[key]
        pub post_id: u256,
        pub tipper: ContractAddress,
        pub author: ContractAddress,
        pub amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, tip_token: ContractAddress) {
        self.ownable.initializer(owner);
        self.tip_token.write(tip_token);
        self.post_counter.write(0);
    }

    #[abi(embed_v0)]
    impl StarkCastFeedImpl of IStarkCastFeed<ContractState> {
        fn post(
            ref self: ContractState,
            content_hash: felt252,
            proof_hash: felt252,
            reply_to: u256,
        ) -> u256 {
            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(content_hash != 0, 'content hash required');

            // If replying, validate parent exists
            if reply_to > 0 {
                let parent_author = self.posts_author.entry(reply_to).read();
                assert(!parent_author.is_zero(), 'parent post not found');
            }

            let post_id = self.post_counter.read() + 1;
            self.post_counter.write(post_id);

            self.posts_author.entry(post_id).write(caller);
            self.posts_content_hash.entry(post_id).write(content_hash);
            self.posts_proof_hash.entry(post_id).write(proof_hash);
            self.posts_tip_total.entry(post_id).write(0);
            self.posts_like_count.entry(post_id).write(0);
            self.posts_reply_to.entry(post_id).write(reply_to);
            self.posts_created_at.entry(post_id).write(get_block_timestamp());

            self
                .emit(
                    PostCreated { post_id, author: caller, content_hash, proof_hash, reply_to },
                );

            post_id
        }

        fn toggle_like(ref self: ContractState, post_id: u256) {
            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');

            let author = self.posts_author.entry(post_id).read();
            assert(!author.is_zero(), 'post not found');

            let current = self.likes.entry((post_id, caller)).read();
            if current == 1 {
                // Unlike
                self.likes.entry((post_id, caller)).write(0);
                let count = self.posts_like_count.entry(post_id).read();
                self.posts_like_count.entry(post_id).write(count - 1);
                self.emit(PostUnliked { post_id, liker: caller });
            } else {
                // Like
                self.likes.entry((post_id, caller)).write(1);
                let count = self.posts_like_count.entry(post_id).read();
                self.posts_like_count.entry(post_id).write(count + 1);
                self.emit(PostLiked { post_id, liker: caller });
            }
        }

        fn tip(ref self: ContractState, post_id: u256, amount: u256) {
            self.reentrancy_guard.start();

            let caller = get_caller_address();
            assert(!caller.is_zero(), 'caller is zero');
            assert(amount > 0, 'amount must be > 0');

            let author = self.posts_author.entry(post_id).read();
            assert(!author.is_zero(), 'post not found');
            assert(author != caller, 'cannot tip yourself');

            // Transfer STRK from tipper directly to author
            let token = IERC20TransferDispatcher {
                contract_address: self.tip_token.read(),
            };
            token.transfer_from(caller, author, amount);

            // Update totals
            let post_tips = self.posts_tip_total.entry(post_id).read();
            self.posts_tip_total.entry(post_id).write(post_tips + amount);
            let author_total = self.author_tips.entry(author).read();
            self.author_tips.entry(author).write(author_total + amount);

            self.emit(PostTipped { post_id, tipper: caller, author, amount });

            self.reentrancy_guard.end();
        }

        fn get_post(self: @ContractState, post_id: u256) -> PostInfo {
            PostInfo {
                author: self.posts_author.entry(post_id).read(),
                content_hash: self.posts_content_hash.entry(post_id).read(),
                proof_hash: self.posts_proof_hash.entry(post_id).read(),
                tip_total: self.posts_tip_total.entry(post_id).read(),
                like_count: self.posts_like_count.entry(post_id).read(),
                reply_to: self.posts_reply_to.entry(post_id).read(),
                created_at: self.posts_created_at.entry(post_id).read(),
            }
        }

        fn get_post_count(self: @ContractState) -> u256 {
            self.post_counter.read()
        }

        fn has_liked(self: @ContractState, post_id: u256, user: ContractAddress) -> bool {
            self.likes.entry((post_id, user)).read() == 1
        }

        fn get_author_tips(self: @ContractState, author: ContractAddress) -> u256 {
            self.author_tips.entry(author).read()
        }

        fn get_tip_token(self: @ContractState) -> ContractAddress {
            self.tip_token.read()
        }
    }
}
