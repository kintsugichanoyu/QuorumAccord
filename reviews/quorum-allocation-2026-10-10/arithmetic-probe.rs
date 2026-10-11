#[path = "/home/user/reflect/programs/quorum-allocation/src/constants.rs"] mod constants;
#[path = "/home/user/reflect/programs/quorum-allocation/src/aggregation.rs"] mod aggregation;
fn aggregate(input: &[[u16; 16]], rule: u8) -> [u16; 16] {
    let mut result = [0u16; 16];
    for v in 0..16 {
        let mut column: Vec<u64> = input.iter().map(|w| w[v] as u64).collect();
        result[v] = aggregation::aggregate_scalar(&mut column, rule, 0) as u16;
    }
    aggregation::renormalize_to_bps(&mut result);
    result
}
fn main() {
    let last = 1_000_000_000_000_000_000u64;
    let current = 2 * last;
    let actual = aggregation::divergence_bps(current, last);
    let expected = (u128::from(current - last) * 10_000 / u128::from(last)) as u64;
    assert_eq!(actual, 18); assert_eq!(expected, 10_000);
    println!("divergence: actual={actual}bps expected={expected}bps");
    let mut capped = [[0u16; 16]; 3];
    for i in 0..3 { capped[i][0] = 5_000; capped[i][i+1] = 5_000; }
    let result = aggregate(&capped, 1);
    assert_eq!(result[0], 10_000);
    println!("median of 50%-capped valid vectors: {:?}", &result[..4]);
    let mut disjoint = [[0u16; 16]; 3];
    for i in 0..3 { disjoint[i][i] = 10_000; }
    let result = aggregate(&disjoint, 1);
    assert!(!aggregation::valid_ratios(&result));
    println!("median of disjoint valid vectors: {:?}; valid_ratios=false", &result[..3]);
    let mut rounded = [[0u16;16];3];
    for i in 0..3 { rounded[i][0]=3_333; rounded[i][1]=3_333; rounded[i][2]=3_333; rounded[i][i]+=1; }
    let result=aggregate(&rounded,0);
    assert_eq!(&result[..4], &[3_334,3_333,3_333,0]);
    println!("PDF deficit destination mismatch: actual={:?}; PDF=[3333,3333,3333,1]", &result[..4]);
}
