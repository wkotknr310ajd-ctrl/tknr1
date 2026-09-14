Attribute VB_Name = "modCommon"
Option Explicit

' シート保護は「誤操作防止」のためのものであり、真の権限管理ではありません。
' 実際の承認権限はユーザーごとのパスワードハッシュ(職員マスタシート)で判定しています。
Public Const SHEET_PROTECT_PASSWORD As String = "shift-sys-2026"

' シート名が「シフト表_」で始まるシートを、すべて部署のシフト表として扱う。
' 部署を追加したいときはシートを追加するだけでよく、コード変更は不要。
Public Sub ApplyProtection()
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        If IsDepartmentSheet(ws) Or ws.Name = "履歴" Then
            On Error Resume Next
            ws.Unprotect Password:=SHEET_PROTECT_PASSWORD
            On Error GoTo 0
            ws.Protect Password:=SHEET_PROTECT_PASSWORD, UserInterfaceOnly:=True, _
                       AllowFiltering:=True, AllowSorting:=False
        End If
    Next ws
End Sub

Public Function IsDepartmentSheet(ByVal ws As Worksheet) As Boolean
    IsDepartmentSheet = (Left$(ws.Name, 5) = "シフト表_")
End Function

' 部署のシフト表シート名を一覧で返す(「シフト表_〇〇」という名前のシートすべて)。
Public Function DepartmentSheetNames() As Collection
    Dim result As New Collection
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        If IsDepartmentSheet(ws) Then
            result.Add ws.Name
        End If
    Next ws
    Set DepartmentSheetNames = result
End Function

Public Function NextRequestId() As String
    Dim cfg As Worksheet
    Set cfg = ThisWorkbook.Sheets("設定")
    Dim n As Long
    n = CLng(cfg.Range("B2").Value)
    n = n + 1
    cfg.Range("B2").Value = n
    NextRequestId = "REQ-" & Format(n, "000000")
End Function

Public Function Now2() As Date
    Now2 = Now
End Function

' 申請者(誰が申請したか)と対象者(誰の勤務が変わるか)は別項目として記録する。
' 単独の勤務変更申請では申請者=対象者だが、2名間の交換申請では異なる場合がある。
Public Sub AppendHistoryRow(ByVal reqId As String, ByVal appliedAt As Date, ByVal applicant As String, _
                             ByVal targetPerson As String, ByVal targetDate As Date, _
                             ByVal beforeShift As String, ByVal afterShift As String, _
                             ByVal reason As String, ByVal status As String, ByVal approver As String, _
                             ByVal approvedAt As Variant, ByVal origReqId As String)
    Dim hist As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Dim r As Long
    r = hist.Cells(hist.Rows.Count, 1).End(xlUp).Row + 1
    If r < 2 Then r = 2

    hist.Cells(r, 1).Value = reqId
    hist.Cells(r, 2).Value = appliedAt
    hist.Cells(r, 2).NumberFormat = "yyyy/mm/dd hh:mm:ss"
    hist.Cells(r, 3).Value = applicant
    hist.Cells(r, 4).Value = targetPerson
    hist.Cells(r, 5).Value = targetDate
    hist.Cells(r, 5).NumberFormat = "yyyy/mm/dd"
    hist.Cells(r, 6).Value = beforeShift
    hist.Cells(r, 7).Value = afterShift
    hist.Cells(r, 8).Value = reason
    hist.Cells(r, 9).Value = status
    hist.Cells(r, 10).Value = approver
    If Not IsEmpty(approvedAt) Then
        If Trim$(CStr(approvedAt)) <> "" Then
            hist.Cells(r, 11).Value = CDate(approvedAt)
            hist.Cells(r, 11).NumberFormat = "yyyy/mm/dd hh:mm:ss"
        End If
    End If
    hist.Cells(r, 12).Value = origReqId
End Sub

Public Function FindStaffMasterRow(ByVal staffName As String) As Long
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("職員マスタ")
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim r As Long
    For r = 2 To lastRow
        If Trim$(CStr(ws.Cells(r, 1).Value)) = Trim$(staffName) Then
            FindStaffMasterRow = r
            Exit Function
        End If
    Next r
    FindStaffMasterRow = 0
End Function

' 全部署のシフト表シートを横断して、氏名が一致する行を探す。
' 見つかった場合はそのセル(A列・該当行)を返す(Worksheetは .Worksheet で取得できる)。
' 見つからない場合は Nothing を返す。
Public Function FindShiftStaffCell(ByVal staffName As String) As Range
    Dim deptName As Variant
    For Each deptName In DepartmentSheetNames()
        Dim ws As Worksheet
        Set ws = ThisWorkbook.Sheets(CStr(deptName))
        Dim lastRow As Long
        lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        Dim r As Long
        For r = 5 To lastRow
            If Trim$(CStr(ws.Cells(r, 1).Value)) = Trim$(staffName) Then
                Set FindShiftStaffCell = ws.Cells(r, 1)
                Exit Function
            End If
        Next r
    Next deptName
    Set FindShiftStaffCell = Nothing
End Function

Public Function FindShiftDayColumn(ByVal ws As Worksheet, ByVal dayNum As Integer) As Long
    Dim c As Long
    For c = 2 To 32
        If IsNumeric(ws.Cells(3, c).Value) Then
            If CLng(ws.Cells(3, c).Value) = dayNum Then
                FindShiftDayColumn = c
                Exit Function
            End If
        End If
    Next c
    FindShiftDayColumn = 0
End Function

' ワークシートの数式からも呼び出せるユーザー定義関数(UDF)。
' 氏名と対象日から、その人が所属する部署のシフト表を自動的に探して現在の勤務内容を返す。
' 見つからない場合は "-" を返す。
Public Function GetCurrentShift(ByVal staffName As String, ByVal targetDate As Variant) As String
    On Error GoTo Fail
    If Trim$(staffName) = "" Then GoTo Fail
    If Not IsDate(targetDate) Then GoTo Fail

    Dim staffCell As Range
    Set staffCell = FindShiftStaffCell(staffName)
    If staffCell Is Nothing Then GoTo Fail

    Dim col As Long
    col = FindShiftDayColumn(staffCell.Worksheet, Day(CDate(targetDate)))
    If col = 0 Then GoTo Fail

    GetCurrentShift = CStr(staffCell.Worksheet.Cells(staffCell.Row, col).Value)
    Exit Function

Fail:
    GetCurrentShift = "-"
End Function

' 同じ申請IDを持つ履歴行をすべて返す。
' 単独申請なら1行、2名間の交換申請なら2行(対象者ごとに1行)が返る。
Public Function FindHistoryRowsById(ByVal reqId As String) As Collection
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("履歴")
    Dim result As New Collection
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim r As Long
    For r = 2 To lastRow
        If Trim$(CStr(ws.Cells(r, 1).Value)) = Trim$(reqId) Then
            result.Add r
        End If
    Next r
    Set FindHistoryRowsById = result
End Function
