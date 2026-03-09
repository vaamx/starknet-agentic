use starknet::ContractAddress;

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct PostInfo {
    pub author: ContractAddress,
    pub content_hash: felt252,
    pub proof_hash: felt252,
    pub tip_total: u256,
    pub like_count: u32,
    pub reply_to: u256,
    pub created_at: u64,
}

#[starknet::interface]
pub trait IStarkCastFeed<TState> {
    /// Post a new cast. `content_hash` is Poseidon hash of the text.
    /// `proof_hash` is optional (0 if none) — links to a Huginn proof.
    /// `reply_to` is 0 for top-level posts, or the post_id being replied to.
    fn post(ref self: TState, content_hash: felt252, proof_hash: felt252, reply_to: u256) -> u256;
    /// Like a post (idempotent — second call unlikes).
    fn toggle_like(ref self: TState, post_id: u256);
    /// Tip a post author in STRK. Transfers `amount` from caller to author.
    fn tip(ref self: TState, post_id: u256, amount: u256);
    /// Read a single post.
    fn get_post(self: @TState, post_id: u256) -> PostInfo;
    /// Total number of posts.
    fn get_post_count(self: @TState) -> u256;
    /// Check if `user` has liked `post_id`.
    fn has_liked(self: @TState, post_id: u256, user: ContractAddress) -> bool;
    /// Get total tips received by an author.
    fn get_author_tips(self: @TState, author: ContractAddress) -> u256;
    /// Get tip token address.
    fn get_tip_token(self: @TState) -> ContractAddress;
}

#[starknet::interface]
pub trait IERC20Transfer<TState> {
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}
