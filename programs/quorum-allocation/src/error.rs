use anchor_lang::prelude::*;

#[error_code]
pub enum QuorumError {
    #[msg("Signer is not the registry admin")]
    Unauthorized,
    #[msg("Signer is not a registered operator")]
    UnauthorizedOperator,
    #[msg("Operator set is full")]
    OperatorSetFull,
    #[msg("Operator already registered")]
    OperatorAlreadyRegistered,
    #[msg("Operator not found")]
    OperatorNotFound,
    #[msg("min_number must be between 1 and MAX_OPERATORS (64)")]
    InvalidQuorum,
    #[msg("Invalid configuration value")]
    InvalidConfig,
    #[msg("Invalid aggregation rule")]
    InvalidRule,
    #[msg("Consensus round is not open")]
    RoundNotOpen,
    #[msg("Submission window has closed")]
    WindowClosed,
    #[msg("Read slot falls outside the consensus window")]
    SlotOutsideWindow,
    #[msg("Submission window is still open")]
    WindowStillOpen,
    #[msg("Submission buffer is full")]
    SubmissionBufferFull,
    #[msg("Operator already submitted this round")]
    DuplicateSubmission,
    #[msg("Round already finalized or closed")]
    AlreadyFinalized,
    #[msg("Consensus account does not match the provided DataFeed / window")]
    IdentityMismatch,
    #[msg("Weight vector does not sum to MAX_BPS")]
    InvalidRatios,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("An older round cannot overwrite more recent published state")]
    StaleRound,
    #[msg("Existing feed window width is immutable; create a new feed")]
    ImmutableWindow,
    #[msg("Use policy-bound allocation v2 instructions")]
    LegacyAllocationDisabled,
    #[msg("Submission violates frozen allocation policy")]
    InvalidAllocationPolicy,
    #[msg("Submission does not match the round input commitment")]
    SnapshotMismatch,
    #[msg("Signer is not an authorized consumer for this round")]
    UnauthorizedConsumer,
    #[msg("Latest published input snapshot must remain available")]
    RetainPublishedSnapshot,
}
