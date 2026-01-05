; ============================================================================
; INPUT DEVICE TEST (入力デバイス・割り込みテスト)
; ============================================================================
;
; このプログラムは、割り込み(Interrupt)と入力デバイスの連動をテストします。
;
; 1. Push Buttons (Port 0x60) :
;      ボタンを押すと、対応する7セグメントLEDに「8」が約3秒間表示されます。
;      入力検知に割り込み(Interrupts)を使用しています。
;
; 2. DIP Switches (Port 0x50-0x57) :
;      スイッチをONにすると、対応するLED (Port 0x00) が点灯します。
;      メインループでのポーリング監視です。
;
; 3. Keypad (Port 0x40) :
;      キーを押すと、ドットマトリクス上の特定の位置が約3秒間点灯します。
;      入力検知に割り込みを使用しています。
;
; ============================================================================

    ; --- リセットベクタ ---
    ORG 0x0000
    JP START

    ; --- 割り込みベクタ (モード1 / RST 38H) ---
    ; 割り込みが発生するとここに飛びます
    ORG 0x0038
    DI                      ; 二重割り込み禁止
    PUSH AF                 ; レジスタ退避
    PUSH BC
    PUSH DE
    PUSH HL
    
    CALL HANDLE_INT         ; 割り込み処理本体へ
    
    POP HL                  ; レジスタ復帰
    POP DE
    POP BC
    POP AF
    EI                      ; 割り込み許可
    RETI                    ; 割り込み復帰

; ----------------------------------------------------------------------------
; 定数定義
; ----------------------------------------------------------------------------
PORT_LED        EQU 0x00    ; 出力: LED
PORT_7SEG_BASE  EQU 0x10    ; 出力: 7セグメント (0x10-0x17)
PORT_LCD_CMD    EQU 0x20
PORT_LCD_DAT    EQU 0x21
PORT_KEYPAD     EQU 0x40    ; 入力: キーパッド
PORT_DIP_BASE   EQU 0x50    ; 入力: DIPスイッチ (0x50-0x57)
PORT_BTN        EQU 0x60    ; 入力: プッシュボタン (Bit 0-7)
PORT_MATRIX_BASE EQU 0x80   ; 出力: ドットマトリクス
PORT_RTC_SEC    EQU 0xC0    ; 入力: RTC秒カウンター
SEG_8           EQU 0x7F    ; '8' のセグメントパターン

; ----------------------------------------------------------------------------
; メインプログラム
; ----------------------------------------------------------------------------
    ORG 0x0100
START:
    LD SP, 0xFFFF
    IM 1                    ; 割り込みモード1 (RST 38H)
    EI                      ; 割り込み有効化

    ; --- 変数初期化 ---
    XOR A
    LD (LAST_SEC), A
    LD (TIMER_MATRIX), A
    
    ; 7セグメント用タイマー(8個)をクリア
    LD HL, TIMER_7SEG
    LD B, 8
INIT_VAR_L:
    LD (HL), 0
    INC HL
    DJNZ INIT_VAR_L

MAIN_LOOP:
    ; 1. DIPスイッチの状態を読み取り、LEDに反映 (ポーリング)
    CALL PROCESS_DIPS
    
    ; 2. タイマーの減算処理 (RTC秒に基づく)
    CALL PROCESS_TIMERS
    
    ; 3. タイマー値に基づいて表示を更新
    CALL UPDATE_DISPLAYS
    
    JP MAIN_LOOP            ; 繰り返し

; ============================================================================
; サブルーチン: DIPスイッチ処理
; DIPスイッチ(0x50-0x57の各Bit0)を読み取り、1つのバイトにまとめてLEDに出力
; ============================================================================
PROCESS_DIPS:
    LD C, 0x50     ; DIPベースポート
    LD B, 0        ; 結果蓄積用
    LD E, 1        ; ビットマスク (00000001 -> 00000010 -> ...)
    LD D, 8        ; 8スイッチ分ループ
DIP_L:
    PUSH BC        ; Cレジスタを破壊しないよう保存
    LD B, 0
    IN A, (C)      ; ポート読み込み (ONなら1、OFFなら0)
    AND 1          ; 最下位ビットのみ有効
    JR Z, DIP_O    ; 0ならスキップ
    POP BC
    LD A, B
    OR E           ; 対応するビットを立てる
    LD B, A
    JR DIP_N
DIP_O:
    POP BC
DIP_N:
    RLC E          ; マスクを左シフト
    INC C          ; 次のポートへ
    DEC D
    JR NZ, DIP_L
    
    ; 結果をLEDに出力
    LD A, B
    OUT (PORT_LED), A
    RET

; ============================================================================
; サブルーチン: タイマー処理
; RTCの秒カウント監視し、変化があったら各種タイマー変数をデクリメントします
; ============================================================================
PROCESS_TIMERS:
    IN A, (PORT_RTC_SEC)    ; 現在の秒を取得
    LD HL, LAST_SEC
    CP (HL)
    RET Z                   ; 秒が変わっていなければリターン
    
    ; 1秒経過
    LD (HL), A              ; 秒を保存
    
    ; マトリクス表示タイマー減算
    LD A, (TIMER_MATRIX)
    OR A
    JR Z, PRO_7
    DEC A
    LD (TIMER_MATRIX), A
    
PRO_7:
    ; 7セグメント表示タイマー(8個)減算
    LD HL, TIMER_7SEG
    LD B, 8
T7_L:
    LD A, (HL)
    OR A
    JR Z, T7_N
    DEC (HL)                ; タイマー > 0 なら -1
T7_N:
    INC HL
    DJNZ T7_L
    RET

; ============================================================================
; サブルーチン: 表示更新
; タイマー変数が > 0 のデバイスを点灯させます
; ============================================================================
UPDATE_DISPLAYS:
    ; --- 7セグメント ---
    LD C, PORT_7SEG_BASE
    LD HL, TIMER_7SEG
    LD B, 8
U7_L:
    LD A, (HL)
    OR A
    LD A, 0
    JR Z, U7_O              ; タイマー=0なら消灯
    LD A, SEG_8             ; タイマー>0なら '8' を表示
U7_O:
    OUT (C), A
    INC C
    INC HL
    DJNZ U7_L
    
    ; --- ドットマトリクス ---
    LD A, (TIMER_MATRIX)
    OR A
    JR Z, CLR_M             ; タイマー=0なら全消灯
    
    CALL CLR_M              ; 一旦消して
    
    ; MATRIX_R(行), MATRIX_C(列) の位置だけ点灯
    ; ポートアドレス計算 (0x80 + R*2 [+1 if C>=8])
    LD A, (MATRIX_R)
    ADD A, A
    ADD A, 0x80
    LD C, A
    LD A, (MATRIX_C)
    CP 8
    JR C, COL_L
    INC C                   ; 右側
    SUB 8
COL_L:
    ; ビットマスク作成 (1 << A)
    LD B, A
    LD A, 1
    OR A
    INC B
SH_L:
    DEC B
    JR Z, SH_D
    SLA A
    JR SH_L
SH_D:
    OUT (C), A              ; 点灯
    RET

CLR_M: ; マトリクス全消去
    LD C, 0x80
    LD B, 32
    XOR A
CM_L:
    OUT (C), A
    INC C
    DJNZ CM_L
    RET

; ============================================================================
; 割り込みハンドラ (HANDLE_INT)
; ボタンやキー入力を検知し、タイマーをセットします
; ============================================================================
HANDLE_INT:
    ; 1. プッシュボタンチェック (0x60)
    IN A, (PORT_BTN)
    OR A
    JR Z, CHK_K             ; ボタン入力なし
    
    ; ビット0-7が各ボタンに対応
    ; 押されたボタンに対応する7セグタイマーをセット(3秒)
    LD HL, TIMER_7SEG
    LD B, 8
SB_L:
    RRA                     ; 最下位ビットをCarryへ
    JR NC, SB_N             ; 0なら押されていない
    LD (HL), 3              ; タイマーセット
SB_N:
    INC HL
    DJNZ SB_L
    
CHK_K:
    ; 2. キーパッドチェック (0x40)
    IN A, (PORT_KEYPAD)
    CP 0xFF
    RET Z                   ; 入力なし
    
    ; 簡易的な座標計算
    ; キーコードをもとに適当なマトリクス座標(R, C)を決定
    LD B, A
    SRL A
    SRL A
    ADD A, A
    ADD A, A
    LD (MATRIX_R), A        ; 行
    LD A, B
    AND 0x03
    ADD A, A
    ADD A, A
    LD (MATRIX_C), A        ; 列
    
    LD A, 3
    LD (TIMER_MATRIX), A    ; マトリクスタイマーセット(3秒)
    RET

; ----------------------------------------------------------------------------
; ワークエリア (Variables)
; ----------------------------------------------------------------------------
    ORG 0x8000
LAST_SEC:       DB 0        ; 秒保存用
TIMER_7SEG:     DS 8        ; 7セグ各桁のタイマー
TIMER_MATRIX:   DB 0        ; マトリクスのタイマー
MATRIX_R:       DB 0        ; 点灯位置 行
MATRIX_C:       DB 0        ; 点灯位置 列
