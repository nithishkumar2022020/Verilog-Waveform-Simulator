`timescale 1ns / 1ps

module jk_ms_ff (
    input clk,        // Clock input
    input reset,      // Asynchronous reset
    input j,          // J input
    input k,          // K input
    output reg q,     // Q output
    output q_bar      // Q' (not Q) output
);
    // Complementary output
    assign q_bar = ~q;
    
    // Internal state for master latch
    reg master_q;
    
    // Master-Slave JK flip-flop implementation
    always @(posedge clk or posedge reset) begin
        if (reset) begin
            master_q <= 1'b0;  // Reset master latch
        end else begin
            // Master latch operates on positive edge of clock
            case ({j, k})
                2'b00: master_q <= master_q;   // No change
                2'b01: master_q <= 1'b0;       // Reset
                2'b10: master_q <= 1'b1;       // Set
                2'b11: master_q <= ~master_q;  // Toggle
            endcase
        end
    end
    
    // Slave latch operates on negative edge of clock
    always @(negedge clk or posedge reset) begin
        if (reset) begin
            q <= 1'b0;  // Reset slave latch
        end else begin
            q <= master_q;  // Transfer master value to slave
        end
    end
endmodule 